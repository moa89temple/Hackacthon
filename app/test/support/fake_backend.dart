import 'dart:async';

import 'package:buddy/backend/buddy_backend.dart';

import 'fake_roadmap.dart';

/// Stands in for the backend. A test decides what the history holds and pushes
/// reply events whenever it wants, so it can look at a reply mid-stream.
class FakeBackend with FakeRoadmapCalls implements BuddyBackend {
  FakeBackend({List<ConversationItem>? history}) : history = history ?? [];

  List<ConversationItem> history;
  Object? historyError;
  int historyLoads = 0;
  final List<String> sent = [];
  StreamController<ReplyEvent> reply = StreamController<ReplyEvent>();

  /// Gets ready for the Student's next message, once the last reply has been closed.
  void nextReply() => reply = StreamController<ReplyEvent>();

  List<ProfileFact> facts = [];
  Object? factsError;

  /// Makes every edit and deletion fail.
  Object? changeError;
  final List<(int, String)> edits = [];
  final List<int> deletions = [];

  /// What the next edit comes back as, when it isn't just the new words.
  EditedFact? nextEditResult;

  List<Connection> connections = [];
  Object? connectionsError;

  /// Makes every read and revoke fail.
  Object? connectionChangeError;
  Object? giveError;
  final List<(String, String?)> gave = [];
  final List<String> revoked = [];
  final List<String> reads = [];

  /// What each change comes back as. By default, the Connection as it was.
  Connection? connectionAfterGive;
  Connection? connectionAfterRevoke;
  Connection? connectionAfterRead;
  bool holdRead = false;
  final Completer<void> _readGate = Completer<void>();

  void releaseRead() => _readGate.complete();

  Connection _changed(String id, Connection? after) {
    final updated = after ?? connections.firstWhere((connection) => connection.id == id);
    connections = [for (final old in connections) old.id == id ? updated : old];
    return updated;
  }

  final List<int> reported = [];
  Object? reportError;

  @override
  Future<void> reportGuidebookItem(int id) async {
    if (reportError case final error?) throw error;
    reported.add(id);
  }

  final List<(int, String)> approvals = [];
  final List<int> declines = [];

  /// What each tap comes back as.
  ActionCard? cardAfterApprove;
  ActionCard? cardAfterDecline;
  ActionCard? cardWhenChecked;
  String? approveRefusal;
  Object? approveError;
  Object? declineError;
  bool holdApprove = false;
  final Completer<void> _approveGate = Completer<void>();

  void releaseApprove() => _approveGate.complete();

  @override
  Future<ActionCardAnswer> approveActionCard(int id, String fingerprint) async {
    approvals.add((id, fingerprint));
    if (holdApprove) await _approveGate.future;
    if (approveError case final error?) throw error;
    return ActionCardAnswer(cardAfterApprove!, refusal: approveRefusal);
  }

  @override
  Future<ActionCardAnswer> declineActionCard(int id) async {
    if (declineError case final error?) throw error;
    declines.add(id);
    return ActionCardAnswer(cardAfterDecline!);
  }

  @override
  Future<ActionCard> loadActionCard(int id) async => cardWhenChecked!;

  final List<(int, String, String)> draftEdits = [];
  Object? draftEditError;
  String? draftEditHiddenNote;

  @override
  Future<EditedDraft> editDraft(int id, {required String subject, required String body}) async {
    if (draftEditError case final error?) throw error;
    draftEdits.add((id, subject, body));
    final old = history.whereType<DraftCardItem>().firstWhere((card) => card.draft.id == id).draft;
    return EditedDraft(
      draft: Draft(id: id, contact: old.contact, why: old.why, subject: subject, body: body),
      hiddenNote: draftEditHiddenNote,
    );
  }

  List<StandardMilestone> upcoming = [];
  Object? upcomingError;

  @override
  Future<List<StandardMilestone>> loadUpcomingMilestones() async {
    if (upcomingError case final error?) throw error;
    return upcoming;
  }

  List<Opportunity> opportunities = [];
  Object? opportunitiesError;
  Object? saveOpportunityError;
  Object? reportOpportunityError;
  final List<(int, bool)> savedTaps = [];
  final List<int> reportedOpportunities = [];
  int opportunityLoads = 0;

  @override
  Future<List<Opportunity>> loadOpportunities() async {
    opportunityLoads++;
    if (opportunitiesError case final error?) throw error;
    return [
      for (final opportunity in opportunities)
        if (!reportedOpportunities.contains(opportunity.id))
          Opportunity(
            id: opportunity.id,
            name: opportunity.name,
            summary: opportunity.summary,
            when: opportunity.when,
            cost: opportunity.cost,
            worthItBecause: opportunity.worthItBecause,
            outsideTemple: opportunity.outsideTemple,
            place: opportunity.place,
            forGoals: opportunity.forGoals,
            saved: savedTaps.reversed.where((tap) => tap.$1 == opportunity.id).firstOrNull?.$2 ?? opportunity.saved,
            sources: opportunity.sources,
          ),
    ];
  }

  @override
  Future<void> setOpportunitySaved(int id, bool saved) async {
    if (saveOpportunityError case final error?) throw error;
    savedTaps.add((id, saved));
  }

  @override
  Future<void> reportOpportunity(int id) async {
    if (reportOpportunityError case final error?) throw error;
    reportedOpportunities.add(id);
  }

  List<ActivityEntry> activity = [];
  Object? activityError;

  Takeover? takeoverUnderWay;
  Takeover? takeoverToStart;
  Object? startTakeoverError;
  final List<String> startedSites = [];
  FinishedTakeover? finished;
  Object? finishError;
  int finishCount = 0;
  bool holdFinish = false;
  final Completer<void> _finishGate = Completer<void>();

  void releaseFinish() => _finishGate.complete();

  @override
  Future<List<ConversationItem>> loadHistory() async {
    historyLoads++;
    if (historyError case final error?) throw error;
    return history;
  }

  @override
  Stream<ReplyEvent> send(String text) {
    sent.add(text);
    return reply.stream;
  }

  @override
  Future<List<ProfileFact>> loadFacts() async {
    if (factsError case final error?) throw error;
    return facts;
  }

  @override
  Future<EditedFact?> editFact(int id, String text) async {
    if (changeError case final error?) throw error;
    edits.add((id, text));
    final old = facts.where((fact) => fact.id == id).firstOrNull;
    if (old == null) return null;
    return nextEditResult ??
        EditedFact(
          fact: ProfileFact(
            id: id,
            text: text,
            isFromConversation: old.isFromConversation,
            savedAt: old.savedAt,
            wasEdited: true,
          ),
        );
  }

  @override
  Future<void> deleteFact(int id) async {
    if (changeError case final error?) throw error;
    deletions.add(id);
  }

  @override
  Future<List<Connection>> loadConnections() async {
    if (connectionsError case final error?) throw error;
    return connections;
  }

  @override
  Future<Connection> giveReadPermission(String id, String? address) async {
    if (giveError case final error?) throw error;
    gave.add((id, address));
    return _changed(id, connectionAfterGive);
  }

  @override
  Future<Connection> revokeReadPermission(String id) async {
    if (connectionChangeError case final error?) throw error;
    revoked.add(id);
    return _changed(id, connectionAfterRevoke);
  }

  @override
  Future<Connection> readConnection(String id) async {
    if (connectionChangeError case final error?) throw error;
    reads.add(id);
    if (holdRead) await _readGate.future;
    return _changed(id, connectionAfterRead);
  }

  @override
  Future<List<ActivityEntry>> loadActivity() async {
    if (activityError case final error?) throw error;
    return activity;
  }

  @override
  Future<Takeover?> currentTakeover() async => takeoverUnderWay;

  @override
  Future<Takeover> startTakeover(String site) async {
    startedSites.add(site);
    if (startTakeoverError case final error?) throw error;
    return takeoverToStart!;
  }

  @override
  Future<FinishedTakeover?> finishTakeover() async {
    finishCount++;
    if (holdFinish) await _finishGate.future;
    if (finishError case final error?) throw error;
    takeoverUnderWay = null;
    return finished;
  }
}
