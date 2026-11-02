import 'package:flutter/foundation.dart';

import '../backend/buddy_backend.dart';
import '../roadmap/roadmap_backend.dart';

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

  /// The Action cards with a tap on its way, which can't take another until it's answered.
  final Set<int> _cardsBeingDecided = {};

  bool isBeingDecided(ActionCard card) => _cardsBeingDecided.contains(card.id);

  /// The Draft card from the latest turn, which should be read out.
  /// Cards loaded from history are never announced.
  DraftCardItem? newestDraftCard;

  /// The Standard Milestones' cards from the latest turn, which should be read out.
  /// Cards loaded from history are never announced.
  List<MilestoneCardItem> newestMilestoneCards = const [];

  /// The Roadmap cards from the latest turn, which should be read out.
  /// Cards loaded from history are never announced.
  List<RoadmapCardItem> newestRoadmapCards = const [];

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
    newestRoadmapCards = const [];
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
          case ReplyRoadmapCard():
            final card = RoadmapCardItem(event.card);
            items = [...items, card];
            newestRoadmapCards = [...newestRoadmapCards, card];
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
    return edited.hiddenNote;
  }

  /// A Roadmap card as the backend says it stands, after a tap on it or a later one.
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
