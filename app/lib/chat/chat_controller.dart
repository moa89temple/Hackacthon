import 'dart:async';

import 'package:flutter/foundation.dart';

import '../backend/buddy_backend.dart';
import '../roadmap/roadmap_backend.dart';
import '../sending/sending_backend.dart';

/// Lives as long as the app, so that a reply keeps streaming while the Student
/// looks at another tab.
class ChatController extends ChangeNotifier {
  ChatController(this._backend);

  static const _cutOff =
      'The app got cut off from Buddy before that reply finished. Check that the backend is running, then try again.';

  final BuddyBackend _backend;
  bool _disposed = false;

  List<ConversationItem> items = const [];
  bool isLoading = true;
  bool couldNotLoad = false;

  /// The reply so far while Buddy is writing, and null the rest of the time.
  String? replyInProgress;

  /// Why the latest turn failed, for the Student to read.
  String? turnError;

  /// The message the Student sent last, which should be brought into view. Null until they send one.
  ChatMessage? newestSent;

  /// The reply that just finished, which screen readers should read out.
  /// Replies loaded from history are never announced.
  ChatMessage? newestReply;

  /// The Student's latest message, if it just came back with something hidden, which screen
  /// readers should read out. Notes loaded from history are never announced.
  ChatMessage? newestHidden;

  /// The Crisis card from the latest turn, which should be read out and brought into view.
  /// Cards loaded from history are never announced.
  CrisisCardItem? newestCard;

  /// The Read Permission card from the latest turn, which should be read out.
  /// Cards loaded from history are never announced.
  ReadPermissionCardItem? newestReadPermissionCard;

  /// The Guidebook cards from the latest turn, which should be read out.
  /// Cards loaded from history are never announced.
  List<GuidebookCardItem> newestGuidebookCards = const [];

  /// The Action cards from the latest turn, which should be read out.
  /// Cards loaded from history are never announced.
  List<ActionCardItem> newestActionCards = const [];

  /// The Action card the Student's tap on Buddy sends it just made, which the list should move to.
  ActionCardItem? newestTappedCard;

  /// The Action cards with a tap on its way, which can't take another until it's answered.
  final Set<int> _cardsBeingDecided = {};

  bool isBeingDecided(ActionCard card) => _cardsBeingDecided.contains(card.id);

  /// The Draft card from the latest turn, which should be read out.
  /// Cards loaded from history are never announced.
  DraftCardItem? newestDraftCard;

  /// The Standard Milestones' cards from the latest turn, which should be read out.
  /// Cards loaded from history are never announced.
  List<MilestoneCardItem> newestMilestoneCards = const [];

  /// The Opportunities' cards from the latest turn, which should be read out.
  /// Cards loaded from history are never announced.
  List<OpportunityCardItem> newestOpportunityCards = const [];

  /// The Roadmap cards from the latest turn, which should be read out.
  /// Cards loaded from history are never announced.
  List<RoadmapCardItem> newestRoadmapCards = const [];

  /// The Task cards from the latest turn, which should be read out.
  /// Cards loaded from history are never announced.
  List<TaskCardItem> newestTaskCards = const [];

  /// A Task reached the Student while a reply was being written, so its cards are still to pick up.
  bool _taskCardsToPickUp = false;

  bool get canSend => !isLoading && !couldNotLoad && replyInProgress == null;

  Future<void> loadHistory() async {
    isLoading = true;
    couldNotLoad = false;
    _changed();
    try {
      items = await _backend.loadHistory();
    } on Exception {
      couldNotLoad = true;
    }
    isLoading = false;
    _changed();
  }

  Future<void> send(String text) async {
    final studentMessageAt = items.length;
    final sent = ChatMessage(isFromBuddy: false, text: text);
    items = [...items, sent];
    newestSent = sent;
    replyInProgress = '';
    turnError = null;
    newestReply = null;
    newestHidden = null;
    newestCard = null;
    newestReadPermissionCard = null;
    newestGuidebookCards = const [];
    newestActionCards = const [];
    newestDraftCard = null;
    newestMilestoneCards = const [];
    newestOpportunityCards = const [];
    newestRoadmapCards = const [];
    newestTaskCards = const [];
    _changed();

    ChatMessage? reply;
    String? failure;
    try {
      await for (final event in _backend.send(text)) {
        switch (event) {
          case ReplyHidden():
            final kept = ChatMessage(isFromBuddy: false, text: event.text, hiddenNote: event.note);
            items = [...items]..[studentMessageAt] = kept;
            newestHidden = kept;
            _changed();
          case ReplyText():
            replyInProgress = replyInProgress! + event.text;
            _changed();
          case ReplyCrisisCard():
            final card = CrisisCardItem();
            items = [...items, card];
            newestCard = card;
            _changed();
          case ReplyReadPermissionCard():
            final card = ReadPermissionCardItem(event.connectionId);
            items = [...items, card];
            newestReadPermissionCard = card;
            _changed();
          case ReplyGuidebookCard():
            final card = GuidebookCardItem(event.item);
            items = [...items, card];
            newestGuidebookCards = [...newestGuidebookCards, card];
            _changed();
          case ReplyActionCard():
            final card = ActionCardItem(event.card);
            items = [...items, card];
            newestActionCards = [...newestActionCards, card];
            _changed();
          case ReplyDraftCard():
            final card = DraftCardItem(event.draft);
            items = [...items, card];
            newestDraftCard = card;
            _changed();
          case ReplyMilestoneCard():
            final card = MilestoneCardItem(event.milestone);
            items = [...items, card];
            newestMilestoneCards = [...newestMilestoneCards, card];
            _changed();
          case ReplyOpportunityCard():
            final card = OpportunityCardItem(event.opportunity);
            items = [...items, card];
            newestOpportunityCards = [...newestOpportunityCards, card];
            _changed();
          case ReplyRoadmapCard():
            final card = RoadmapCardItem(event.card);
            // The backend has already stopped any earlier waiting card working.
            items = [
              for (final existing in items)
                if (existing is RoadmapCardItem && existing.card.status == RoadmapCardStatus.waiting)
                  RoadmapCardItem(existing.card.withStatus(RoadmapCardStatus.replaced))
                else
                  existing,
              card,
            ];
            newestRoadmapCards = [...newestRoadmapCards, card];
            _changed();
          case ReplyTaskCard():
            final card = TaskCardItem(event.task);
            items = [...items, card];
            newestTaskCards = [...newestTaskCards, card];
            _changed();
          case ReplyDone():
            reply = event.reply;
          case ReplyFailed():
            failure = event.message;
        }
      }
    } on Exception {
      failure = _cutOff;
    }

    if (reply != null) {
      items = [...items, reply];
      newestReply = reply;
    } else {
      turnError = failure ?? _cutOff;
    }
    replyInProgress = null;
    _changed();
    if (_taskCardsToPickUp) unawaited(pickUpWhatTasksLeft());
  }

  /// Throws if the backend can't be reached, and then nothing changes. Every card of the item goes,
  /// because the Student has just said it's wrong.
  Future<void> report(GuidebookItem item) async {
    await _backend.reportGuidebookItem(item.id);
    items = [
      for (final existing in items)
        if (existing is GuidebookCardItem && existing.item?.id == item.id)
          GuidebookCardItem(null, reportedJustNow: true)
        else if (existing is DraftCardItem && existing.draft.contact?.id == item.id)
          DraftCardItem(existing.draft.withoutContact())
        else
          existing,
    ];
    _changed();
  }

  /// The Student's Approve tap. Returns why it didn't count, when it didn't. Throws if there's no
  /// telling what the backend did, and then tapping again is safe.
  Future<String?> approve(ActionCard card) =>
      _decide(card, () => _backend.approveActionCard(card.id, card.fingerprint));

  /// The Student's Decline tap. Returns why it didn't count, when it didn't.
  Future<String?> decline(ActionCard card) => _decide(card, () => _backend.declineActionCard(card.id));

  /// Only one tap at a time goes to the backend for a card, however fast the Student taps.
  Future<String?> _decide(ActionCard card, Future<ActionCardAnswer> Function() tap) async {
    if (!_cardsBeingDecided.add(card.id)) return null;
    _changed();
    try {
      final answer = await tap();
      _showCard(answer.card);
      return answer.refusal;
    } finally {
      _cardsBeingDecided.remove(card.id);
      _changed();
    }
  }

  /// The Student's tap on Buddy sends it, which makes a card and sends nothing. Tapping again shows the
  /// same card. Returns why there's no card, when there isn't. Throws if the backend can't be reached.
  Future<String?> askForSendCard(Draft draft) async {
    final ActionCard card;
    try {
      card = await _backend.askForSendCard(draft.id);
    } on SendingRefused catch (refused) {
      return refused.message;
    }
    _showTappedCard(card);
    return null;
  }

  void _showTappedCard(ActionCard card) {
    final item = ActionCardItem(card);
    items = [...items.where((existing) => !(existing is ActionCardItem && existing.card.id == card.id)), item];
    newestActionCards = [item];
    newestTappedCard = item;
    _changed();
  }

  /// Called when something here has changed the mode, so that the You tab shows it.
  VoidCallback? onSendingChanged;

  /// How things stand for the Crisis card's offer. Throws if the backend can't be reached.
  Future<CrisisEmailOffer> loadCrisisEmailOffer() => _backend.loadCrisisEmailOffer();

  /// Goes up whenever a Crisis card's offer should ask again how things stand.
  int crisisOfferChecks = 0;

  /// The mode can change on the You tab or on a card, and TUmail can be connected or logged in to.
  void checkCrisisOffers() {
    crisisOfferChecks++;
    _changed();
  }

  /// The Student's tap on the Crisis card's offer, which makes a card and sends nothing. Returns why
  /// there's no card, when there isn't. Throws if the backend can't be reached.
  Future<String?> askForCrisisEmailCard({required String name, required String address, required String subject, required String body}) async {
    final ActionCard card;
    try {
      card = await _backend.askForCrisisEmailCard(name: name, address: address, subject: subject, body: body);
    } on SendingRefused catch (refused) {
      return refused.message;
    }
    _showTappedCard(card);
    return null;
  }

  /// The Student's tap on the offer to switch to Live, once they've said yes to the switch. Throws if the
  /// backend can't be reached.
  Future<void> switchToLive() async {
    await _backend.switchToLive();
    onSendingChanged?.call();
    unawaited(checkWaitingCards());
  }

  /// The same from a Practice card, which stops that card and makes a new one needing its own Approve tap.
  /// Returns why there's no new card, when there isn't. Throws if the backend can't be reached.
  Future<String?> switchCardToLive(ActionCard card) async {
    if (!_cardsBeingDecided.add(card.id)) return null;
    _changed();
    try {
      String? refusal;
      try {
        _showTappedCard(await _backend.switchCrisisEmailToLive(card.id));
      } on SendingRefused catch (refused) {
        refusal = refused.message;
      }
      onSendingChanged?.call();
      checkCrisisOffers();
      await checkWaitingCards();
      return refusal;
    } finally {
      _cardsBeingDecided.remove(card.id);
      _changed();
    }
  }

  /// A change somewhere else can stop a waiting card, so these ask the backend how each stands. If it
  /// can't be reached the card stays as it was, and an Approve tap would still be refused.
  Future<void> checkWaitingCards() async {
    for (final item in items.whereType<ActionCardItem>().toList()) {
      if (!item.card.canDecide) continue;
      try {
        _showCard(await _backend.loadActionCard(item.card.id));
      } on Exception {
        continue;
      }
    }
    _changed();
  }

  /// Asks the backend how a card that was running has got on.
  Future<void> checkCard(ActionCard card) async {
    _showCard(await _backend.loadActionCard(card.id));
    _changed();
  }

  void _showCard(ActionCard card) {
    items = [
      for (final existing in items)
        if (existing is ActionCardItem && existing.card.id == card.id) ActionCardItem(card) else existing,
    ];
  }

  /// Throws if the backend can't be reached, and then nothing changes. Returns what to tell the
  /// Student if something they typed was hidden.
  Future<String?> editDraft(int id, {required String subject, required String body}) async {
    final edited = await _backend.editDraft(id, subject: subject, body: body);
    items = [
      for (final existing in items)
        if (existing is DraftCardItem && existing.draft.id == id) DraftCardItem(edited.draft) else existing,
    ];
    _changed();
    unawaited(checkWaitingCards());
    return edited.hiddenNote;
  }

  /// A read that isn't part of a turn can leave a Roadmap card in the conversation, or stop one working. The
  /// Student finds that when they come back to this tab. With nothing new about the cards, nothing moves.
  Future<void> pickUpRoadmapCards() async {
    if (isLoading || replyInProgress != null) return;
    final List<ConversationItem> loaded;
    try {
      loaded = await _backend.loadHistory();
    } on Exception {
      return;
    }
    if (_disposed || replyInProgress != null) return;
    final known = {
      for (final item in items)
        if (item is RoadmapCardItem) item.card.id: item.card.status,
    };
    final cards = loaded.whereType<RoadmapCardItem>();
    if (cards.every((item) => known[item.card.id] == item.card.status)) return;
    items = loaded;
    newestRoadmapCards = [
      for (final item in cards)
        if (!known.containsKey(item.card.id)) item,
    ];
    _changed();
  }

  /// A Task leaves cards in the conversation with no turn to bring them: an Action card, a card asking for a login, or
  /// its own card moving to the end. A reply being written comes first, and this runs when it's over.
  Future<void> pickUpWhatTasksLeft() async {
    if (isLoading || replyInProgress != null) {
      _taskCardsToPickUp = true;
      return;
    }
    _taskCardsToPickUp = false;
    final List<ConversationItem> loaded;
    try {
      loaded = await _backend.loadHistory();
    } on Exception {
      return;
    }
    if (_disposed) return;
    // A reply may have started while this was on its way, and this would take its place.
    if (replyInProgress != null) {
      _taskCardsToPickUp = true;
      return;
    }
    final knownCards = {
      for (final item in items)
        if (item is ActionCardItem) item.card.id,
    };
    // What the Student has written on a Crisis card lives in its item, and this mustn't lose that.
    final crisisCards = items.whereType<CrisisCardItem>().iterator;
    items = [
      for (final item in loaded)
        if (item is CrisisCardItem && crisisCards.moveNext()) crisisCards.current else item,
    ];
    newestActionCards = [
      for (final item in items)
        if (item is ActionCardItem && !knownCards.contains(item.card.id)) item,
    ];
    _changed();
  }

  /// A Roadmap card as the backend says it stands, after a tap on it.
  void showRoadmapCard(RoadmapCard card) {
    items = [
      for (final existing in items)
        if (existing is RoadmapCardItem && existing.card.id == card.id) RoadmapCardItem(card) else existing,
    ];
    _changed();
  }

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
