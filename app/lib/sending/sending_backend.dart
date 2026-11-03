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

/// How things stand for the Crisis card's offer to email someone, as the backend says.
class CrisisEmailOffer {
  const CrisisEmailOffer({required this.whyNotYet, required this.isLive, required this.ownAddress, required this.tuttleman});

  factory CrisisEmailOffer.fromJson(Map<String, dynamic> json) => CrisisEmailOffer(
        whyNotYet: json['whyNotYet'] as String?,
        isLive: json['isLive'] == true,
        ownAddress: json['ownAddress'] as String?,
        tuttleman: switch (json['tuttleman']) {
          final Map<String, dynamic> item => GuidebookItem.fromJson(item),
          _ => null,
        },
      );

  /// Why an email can't go out yet, for the Student, when it can't.
  final String? whyNotYet;
  final bool isLive;
  final String? ownAddress;

  /// Tuttleman Counseling as the Guidebook has it, when that gives one address to write to.
  final GuidebookItem? tuttleman;
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

  /// How things stand for the Crisis card's offer.
  Future<CrisisEmailOffer> loadCrisisEmailOffer();

  /// Makes the Action card for an email from the Crisis card, without sending anything. Throws
  /// [SendingRefused] when Buddy won't make one.
  Future<ActionCard> askForCrisisEmailCard({required String name, required String address, required String subject, required String body});

  /// Switches to Live from a Practice card, and answers with the new card that needs its own Approve tap.
  /// It goes by the card's number alone, so that the backend's own record decides what the new card says.
  /// Throws [SendingRefused] when Buddy won't make one.
  Future<ActionCard> switchCrisisEmailToLive(int cardId);
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

  @override
  Future<CrisisEmailOffer> loadCrisisEmailOffer() async =>
      CrisisEmailOffer.fromJson((await sendingCall('GET', '/crisis-email/offer'))['offer'] as Map<String, dynamic>);

  @override
  Future<ActionCard> askForCrisisEmailCard({required String name, required String address, required String subject, required String body}) async =>
      ActionCard.fromJson((await sendingCall('POST', '/crisis-email/card', {'name': name, 'address': address, 'subject': subject, 'body': body}))['card'] as Map<String, dynamic>);

  @override
  Future<ActionCard> switchCrisisEmailToLive(int cardId) async =>
      ActionCard.fromJson((await sendingCall('POST', '/crisis-email/cards/$cardId/live'))['card'] as Map<String, dynamic>);
}
