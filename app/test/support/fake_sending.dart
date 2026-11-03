import 'dart:async';

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

  /// How things stand for the Crisis card's offer. Holding it means the backend never answers.
  CrisisEmailOffer crisisOffer = const CrisisEmailOffer(whyNotYet: null, isLive: false, ownAddress: 'student@temple.test', tuttleman: null);
  Completer<void>? holdCrisisOffer;
  Object? crisisOfferError;

  @override
  Future<CrisisEmailOffer> loadCrisisEmailOffer() async {
    if (holdCrisisOffer case final hold?) await hold.future;
    if (crisisOfferError case final error?) throw error;
    return crisisOffer;
  }

  /// What the Crisis card's offer comes back as.
  ActionCard? crisisCardToMake;
  String? crisisCardRefusal;
  Object? crisisCardError;
  final List<({String name, String address, String subject, String body})> crisisEmailsAskedFor = [];

  @override
  Future<ActionCard> askForCrisisEmailCard({required String name, required String address, required String subject, required String body}) async {
    if (crisisCardError case final error?) throw error;
    if (crisisCardRefusal case final refusal?) throw SendingRefused(refusal);
    crisisEmailsAskedFor.add((name: name, address: address, subject: subject, body: body));
    return crisisCardToMake!;
  }

  /// What switching to Live from a Practice card comes back as.
  ActionCard? cardAfterLive;
  String? crisisLiveRefusal;
  final List<int> crisisCardsSwitched = [];

  @override
  Future<ActionCard> switchCrisisEmailToLive(int cardId) async {
    crisisCardsSwitched.add(cardId);
    sending = SendingSettings(isLive: true, ownAddress: sending.ownAddress);
    if (crisisLiveRefusal case final refusal?) throw SendingRefused(refusal);
    return cardAfterLive!;
  }
}
