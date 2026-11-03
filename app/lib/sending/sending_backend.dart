import '../backend/buddy_backend.dart';

/// Where what Buddy sends goes. Anything but a clear "live" from the backend counts as Practice mode.
class SendingSettings {
  const SendingSettings({required this.isLive, required this.ownAddress});

  factory SendingSettings.fromJson(Map<String, dynamic> json) => SendingSettings(
        isLive: json['mode'] == 'live',
        ownAddress: json['ownAddress'] as String?,
      );

  final bool isLive;

  /// The Student's own TUmail address. Null until they've said what it is.
  final String? ownAddress;
}

/// The backend said no, in words for the Student.
class SendingRefused implements Exception {
  const SendingRefused(this.message);

  final String message;
}

/// What the app needs from the backend for sending. Each of these comes from the Student's own tap.
abstract interface class SendingBackend {
  Future<SendingSettings> loadSending();

  Future<SendingSettings> switchToLive();

  Future<SendingSettings> switchToPractice();

  /// Throws [SendingRefused] when it isn't an address Buddy can take.
  Future<SendingSettings> saveOwnAddress(String address);

  /// Makes the Action card for a Draft, without sending anything. It goes by the Draft's number alone,
  /// so that the backend's own record decides what the card says. Throws [SendingRefused] when Buddy
  /// won't make one.
  Future<ActionCard> askForSendCard(int draftId);
}

mixin HttpSendingCalls implements SendingBackend {
  /// Throws [SendingRefused] when the backend says why not, and otherwise unless the backend said yes.
  Future<Map<String, dynamic>> sendingCall(String method, String path, [Object? body]);

  Future<SendingSettings> _settings(String method, String path, [Object? body]) async =>
      SendingSettings.fromJson((await sendingCall(method, path, body))['sending'] as Map<String, dynamic>);

  @override
  Future<SendingSettings> loadSending() => _settings('GET', '/sending');

  @override
  Future<SendingSettings> switchToLive() => _settings('POST', '/sending/live');

  @override
  Future<SendingSettings> switchToPractice() => _settings('POST', '/sending/practice');

  @override
  Future<SendingSettings> saveOwnAddress(String address) => _settings('PUT', '/sending/own-address', {'address': address});

  @override
  Future<ActionCard> askForSendCard(int draftId) async =>
      ActionCard.fromJson((await sendingCall('POST', '/drafts/$draftId/send-card'))['card'] as Map<String, dynamic>);
}
