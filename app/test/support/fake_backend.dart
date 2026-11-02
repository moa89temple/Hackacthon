import 'dart:async';

import 'package:buddy/backend/buddy_backend.dart';

/// Stands in for the backend. A test decides what the history holds and pushes
/// reply events whenever it wants, so it can look at a reply mid-stream.
class FakeBackend implements BuddyBackend {
  FakeBackend({List<ConversationItem>? history}) : history = history ?? [];

  List<ConversationItem> history;
  Object? historyError;
  int historyLoads = 0;
  final List<String> sent = [];
  StreamController<ReplyEvent> reply = StreamController<ReplyEvent>();

  /// Gets ready for the Student's next message, once the last reply has been closed.
  void nextReply() => reply = StreamController<ReplyEvent>();

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
