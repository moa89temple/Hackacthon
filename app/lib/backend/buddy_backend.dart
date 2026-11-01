import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

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

/// What the app needs from the backend.
abstract interface class BuddyBackend {
  Future<List<ChatMessage>> loadHistory();

  /// Sends the Student's message. The stream carries Buddy's turn.
  Stream<ReplyEvent> send(String text);
}

class HttpBuddyBackend implements BuddyBackend {
  HttpBuddyBackend(Uri baseUrl, {http.Client? client})
      : _messagesUrl = baseUrl.resolve('/conversation/messages'),
        _client = client ?? http.Client();

  final Uri _messagesUrl;
  final http.Client _client;

  @override
  Future<List<ChatMessage>> loadHistory() async {
    final response = await _client.get(_messagesUrl);
    if (response.statusCode != 200) {
      throw BackendException('Loading history failed with ${response.statusCode}');
    }
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    return [
      for (final message in body['messages'] as List<dynamic>)
        ChatMessage.fromJson(message as Map<String, dynamic>),
    ];
  }

  @override
  Stream<ReplyEvent> send(String text) async* {
    final request = http.Request('POST', _messagesUrl)
      ..headers['content-type'] = 'application/json'
      ..body = jsonEncode({'text': text});
    final response = await _client.send(request);
    if (response.statusCode != 200) {
      throw BackendException('Sending failed with ${response.statusCode}');
    }

    final lines = response.stream.transform(utf8.decoder).transform(const LineSplitter());
    await for (final line in lines) {
      if (!line.startsWith('data: ')) continue;
      final event = _parseEvent(jsonDecode(line.substring(6)) as Map<String, dynamic>);
      if (event != null) yield event;
    }
  }

  /// Returns null for event types added after this version of the app.
  ReplyEvent? _parseEvent(Map<String, dynamic> json) => switch (json['type']) {
        'text' => ReplyText(json['text'] as String),
        'done' => ReplyDone(ChatMessage.fromJson(json['reply'] as Map<String, dynamic>)),
        'error' => ReplyFailed(json['message'] as String),
        _ => null,
      };
}
