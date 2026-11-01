import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../device/device_store.dart';
import '../device/pairing_details.dart';

/// A pairing request gets this long. Without Tailscale on, the phone would otherwise wait minutes.
const _pairingTimeout = Duration(seconds: 20);

class ChatMessage {
  const ChatMessage({required this.isFromBuddy, required this.text});

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        isFromBuddy: json['role'] == 'buddy',
        text: json['text'] as String,
      );

  final bool isFromBuddy;
  final String text;
}

sealed class ReplyEvent {
  const ReplyEvent();
}

/// More of Buddy's reply, as Claude writes it.
class ReplyText extends ReplyEvent {
  const ReplyText(this.text);
  final String text;
}

/// The turn ended. This is the reply as saved, and it replaces whatever streamed in.
class ReplyDone extends ReplyEvent {
  const ReplyDone(this.reply);
  final ChatMessage reply;
}

/// The turn failed, and [message] is meant for the Student.
class ReplyFailed extends ReplyEvent {
  const ReplyFailed(this.message);
  final String message;
}

class BackendException implements Exception {
  const BackendException(this.message);
  final String message;

  @override
  String toString() => 'BackendException: $message';
}

/// The backend said no to a pairing code.
class PairingRefused implements Exception {
  const PairingRefused();
}

/// The Student in control of Buddy's Browser.
class Takeover {
  const Takeover({
    required this.site,
    required this.siteName,
    required this.liveViewUrl,
    this.liveViewHeaders = const {},
  });

  final String site;
  final String siteName;

  /// Always an address on the backend. The app never connects to the browser directly.
  final Uri liveViewUrl;

  /// What the live view must open its page with.
  final Map<String, String> liveViewHeaders;
}

/// What came of tapping Done.
class FinishedTakeover {
  const FinishedTakeover({required this.siteName, required this.signedIn, this.title});

  factory FinishedTakeover.fromJson(Map<String, dynamic> json) => FinishedTakeover(
        siteName: json['siteName'] as String,
        signedIn: json['signedIn'] as bool,
        title: json['title'] as String?,
      );

  final String siteName;
  final bool signedIn;

  /// The title of the page Buddy read to check the login.
  final String? title;
}

/// What the app needs from the backend.
abstract interface class BuddyBackend {
  Future<List<ChatMessage>> loadHistory();

  /// Sends the Student's message. The stream carries Buddy's turn.
  Stream<ReplyEvent> send(String text);

  /// The Takeover under way, if there is one.
  Future<Takeover?> currentTakeover();

  /// Gives the Student control of Buddy's Browser, on this site.
  Future<Takeover> startTakeover(String site);

  /// Hands control back to Buddy. Returns null if the Takeover had already ended.
  Future<FinishedTakeover?> finishTakeover();
}

/// How the app gets a device key, and a backend that uses it.
abstract interface class BackendAccess {
  /// Throws [PairingRefused] if the backend says no to the code, or another exception if it
  /// can't be reached.
  Future<PairedDevice> pair(PairingDetails details);

  /// [onKeyRefused] runs when the backend no longer accepts this phone's key.
  BuddyBackend open(PairedDevice device, {required void Function() onKeyRefused});
}

class HttpBackendAccess implements BackendAccess {
  HttpBackendAccess({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  @override
  Future<PairedDevice> pair(PairingDetails details) async {
    final response = await _client
        .post(
          details.address.resolve('/devices/pair'),
          headers: {'content-type': 'application/json'},
          body: jsonEncode({'code': details.code}),
        )
        .timeout(_pairingTimeout);
    if (response.statusCode == 401) throw const PairingRefused();
    if (response.statusCode != 200) {
      throw BackendException('Pairing failed with ${response.statusCode}');
    }
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    return PairedDevice(address: details.address, key: body['deviceKey'] as String);
  }

  @override
  BuddyBackend open(PairedDevice device, {required void Function() onKeyRefused}) => HttpBuddyBackend(
        device.address,
        deviceKey: device.key,
        onKeyRefused: onKeyRefused,
        client: _client,
      );
}

class HttpBuddyBackend implements BuddyBackend {
  HttpBuddyBackend(
    Uri baseUrl, {
    required String deviceKey,
    required this._onKeyRefused,
    http.Client? client,
  })  : _baseUrl = baseUrl,
        _messagesUrl = baseUrl.resolve('/conversation/messages'),
        _takeoverUrl = baseUrl.resolve('/takeover'),
        _keyHeader = {'authorization': 'Bearer $deviceKey'},
        _client = client ?? http.Client();

  final Uri _baseUrl;
  final Uri _messagesUrl;
  final Uri _takeoverUrl;
  final Map<String, String> _keyHeader;
  final void Function() _onKeyRefused;
  final http.Client _client;

  /// Throws unless the backend said yes. Every response comes through here, so that a refused key
  /// is noticed whichever operation meets it.
  void _check(int status, String failure) {
    if (status == 200) return;
    if (status == 401) _onKeyRefused();
    throw BackendException('$failure failed with $status');
  }

  @override
  Future<List<ChatMessage>> loadHistory() async {
    final response = await _client.get(_messagesUrl, headers: _keyHeader);
    _check(response.statusCode, 'Loading history');
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    return [
      for (final message in body['messages'] as List<dynamic>)
        ChatMessage.fromJson(message as Map<String, dynamic>),
    ];
  }

  @override
  Stream<ReplyEvent> send(String text) async* {
    final request = http.Request('POST', _messagesUrl)
      ..headers.addAll(_keyHeader)
      ..headers['content-type'] = 'application/json'
      ..body = jsonEncode({'text': text});
    final response = await _client.send(request);
    _check(response.statusCode, 'Sending');

    final lines = response.stream.transform(utf8.decoder).transform(const LineSplitter());
    await for (final line in lines) {
      if (!line.startsWith('data: ')) continue;
      final event = _parseEvent(jsonDecode(line.substring(6)) as Map<String, dynamic>);
      if (event != null) yield event;
    }
  }

  @override
  Future<Takeover?> currentTakeover() async {
    final response = await _client.get(_takeoverUrl, headers: _keyHeader);
    _check(response.statusCode, 'Checking for a Takeover');
    return _parseTakeover(_decode(response)['takeover'] as Map<String, dynamic>?);
  }

  @override
  Future<Takeover> startTakeover(String site) async {
    final response = await _client.post(
      _takeoverUrl,
      headers: {..._keyHeader, 'content-type': 'application/json'},
      body: jsonEncode({'site': site}),
    );
    _check(response.statusCode, 'Starting a Takeover');
    return _parseTakeover(_decode(response)['takeover'] as Map<String, dynamic>)!;
  }

  @override
  Future<FinishedTakeover?> finishTakeover() async {
    final response = await _client.post(_takeoverUrl.resolve('/takeover/done'), headers: _keyHeader);
    if (response.statusCode == 409) return null;
    _check(response.statusCode, 'Finishing the Takeover');
    return FinishedTakeover.fromJson(_decode(response));
  }

  Map<String, dynamic> _decode(http.Response response) =>
      jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;

  Takeover? _parseTakeover(Map<String, dynamic>? json) => json == null
      ? null
      : Takeover(
          site: json['site'] as String,
          siteName: json['siteName'] as String,
          liveViewUrl: _baseUrl.resolve(json['liveViewPath'] as String),
          liveViewHeaders: _keyHeader,
        );

  /// Returns null for event types added after this version of the app.
  ReplyEvent? _parseEvent(Map<String, dynamic> json) => switch (json['type']) {
        'text' => ReplyText(json['text'] as String),
        'done' => ReplyDone(ChatMessage.fromJson(json['reply'] as Map<String, dynamic>)),
        'error' => ReplyFailed(json['message'] as String),
        _ => null,
      };
}
