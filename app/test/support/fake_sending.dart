import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/sending/sending_backend.dart';

/// Stands in for the backend's sending. Made-up fixtures, only ever in tests, and nothing here sends anything.
mixin FakeSendingCalls implements SendingBackend {
  SendingSettings sending = const SendingSettings(isLive: false, ownAddress: null);
  Object? sendingError;

  /// Makes every change fail, while loading still works.
  Object? sendingChangeError;
  String? ownAddressRefusal;
  final List<String> modesAskedFor = [];
  final List<String> ownAddressesSaved = [];

  /// What tapping Buddy sends it comes back as.
  ActionCard? cardToSend;
  String? sendCardRefusal;
  Object? sendCardError;
  final List<int> sendCardsAskedFor = [];

  @override
  Future<SendingSettings> loadSending() async {
    if (sendingError case final error?) throw error;
    return sending;
  }

  @override
  Future<SendingSettings> switchToLive() async {
    if (sendingChangeError case final error?) throw error;
    modesAskedFor.add('live');
    return sending = SendingSettings(isLive: true, ownAddress: sending.ownAddress);
  }

  @override
  Future<SendingSettings> switchToPractice() async {
    if (sendingChangeError case final error?) throw error;
    modesAskedFor.add('practice');
    return sending = SendingSettings(isLive: false, ownAddress: sending.ownAddress);
  }

  @override
  Future<SendingSettings> saveOwnAddress(String address) async {
    if (sendingChangeError case final error?) throw error;
    if (ownAddressRefusal case final refusal?) throw SendingRefused(refusal);
    ownAddressesSaved.add(address);
    return sending = SendingSettings(isLive: sending.isLive, ownAddress: address);
  }

  @override
  Future<ActionCard> askForSendCard(int draftId) async {
    sendCardsAskedFor.add(draftId);
    if (sendCardError case final error?) throw error;
    if (sendCardRefusal case final refusal?) throw SendingRefused(refusal);
    return cardToSend!;
  }
}
