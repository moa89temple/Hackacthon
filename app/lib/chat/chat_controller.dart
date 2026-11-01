import 'package:flutter/foundation.dart';

import '../backend/buddy_backend.dart';

/// Lives as long as the app, so that a reply keeps streaming while the Student
/// looks at another tab.
class ChatController extends ChangeNotifier {
  ChatController(this._backend);

  static const _cutOff =
      'The app got cut off from Buddy before that reply finished. Check that the backend is running, then try again.';

  final BuddyBackend _backend;
  bool _disposed = false;

  List<ChatMessage> messages = const [];
  bool isLoading = true;
  bool couldNotLoad = false;

  /// The reply so far while Buddy is writing, and null the rest of the time.
  String? replyInProgress;

  /// Why the latest turn failed, for the Student to read.
  String? turnError;

  /// The reply that just finished, which screen readers should read out.
  /// Replies loaded from history are never announced.
  ChatMessage? newestReply;

  bool get isEmptyConversation => messages.isEmpty && replyInProgress == null && turnError == null;

  bool get canSend => !isLoading && !couldNotLoad && replyInProgress == null;

  Future<void> loadHistory() async {
    isLoading = true;
    couldNotLoad = false;
    _changed();
    try {
      messages = await _backend.loadHistory();
    } on Exception {
      couldNotLoad = true;
    }
    isLoading = false;
    _changed();
  }

  Future<void> send(String text) async {
    messages = [...messages, ChatMessage(isFromBuddy: false, text: text)];
    replyInProgress = '';
    turnError = null;
    newestReply = null;
    _changed();

    ChatMessage? reply;
    String? failure;
    try {
      await for (final event in _backend.send(text)) {
        switch (event) {
          case ReplyText():
            replyInProgress = replyInProgress! + event.text;
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
      messages = [...messages, reply];
      newestReply = reply;
    } else {
      turnError = failure ?? _cutOff;
    }
    replyInProgress = null;
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
