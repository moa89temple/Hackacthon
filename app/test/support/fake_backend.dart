import 'dart:async';

import 'package:buddy/backend/buddy_backend.dart';

/// Stands in for the backend. A test decides what the history holds and pushes
/// reply events whenever it wants, so it can look at a reply mid-stream.
class FakeBackend implements BuddyBackend {
  FakeBackend({List<ChatMessage>? history}) : history = history ?? [];

  List<ChatMessage> history;
  Object? historyError;
  final List<String> sent = [];
  final StreamController<ReplyEvent> reply = StreamController<ReplyEvent>();

  @override
  Future<List<ChatMessage>> loadHistory() async {
    if (historyError case final error?) throw error;
    return history;
  }

  @override
  Stream<ReplyEvent> send(String text) {
    sent.add(text);
    return reply.stream;
  }
}
