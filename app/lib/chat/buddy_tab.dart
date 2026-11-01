import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../widgets/buddy_avatar.dart';
import 'chat_controller.dart';

class BuddyTab extends StatelessWidget {
  const BuddyTab({super.key, required this.chat});

  final ChatController chat;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: chat,
      builder: (context, _) => Column(
        children: [
          Expanded(child: _body()),
          _Composer(chat: chat),
        ],
      ),
    );
  }

  Widget _body() {
    if (chat.isLoading) {
      return const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading your conversation'));
    }
    if (chat.couldNotLoad) return _CouldNotLoad(onRetry: chat.loadHistory);
    if (chat.isEmptyConversation) return const _Welcome();
    return _MessageList(chat: chat);
  }
}

class _MessageList extends StatelessWidget {
  const _MessageList({required this.chat});

  final ChatController chat;

  @override
  Widget build(BuildContext context) {
    final items = <Widget>[
      if (chat.turnError case final error?) _TurnError(message: error),
      if (chat.replyInProgress case final text?) _ReplyInProgress(text: text),
      for (final message in chat.messages.reversed)
        _SavedMessage(message: message, announce: identical(message, chat.newestReply)),
    ];
    // Reversed, so the newest message stays at the bottom as the reply grows.
    return ListView.builder(
      reverse: true,
      padding: const EdgeInsets.all(12),
      itemCount: items.length,
      itemBuilder: (context, index) => items[index],
    );
  }
}

class _SavedMessage extends StatelessWidget {
  const _SavedMessage({required this.message, required this.announce});

  final ChatMessage message;
  final bool announce;

  @override
  Widget build(BuildContext context) {
    final speaker = message.isFromBuddy ? 'Buddy said' : 'You said';
    return Semantics(
      container: true,
      liveRegion: announce,
      label: '$speaker: ${message.text}',
      excludeSemantics: true,
      child: message.isFromBuddy ? _BuddyBubble(text: message.text) : _StudentBubble(text: message.text),
    );
  }
}

/// Screen readers hear that Buddy is writing, then the whole reply once it's
/// finished, rather than every chunk as it arrives.
class _ReplyInProgress extends StatelessWidget {
  const _ReplyInProgress({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      liveRegion: true,
      label: 'Buddy is writing a reply',
      excludeSemantics: true,
      child: _BuddyBubble(text: text.isEmpty ? '…' : text),
    );
  }
}

class _BuddyBubble extends StatelessWidget {
  const _BuddyBubble({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const BuddyAvatar(radius: 16),
          const SizedBox(width: 8),
          Flexible(
            child: _Bubble(
              text: text,
              background: colors.surfaceContainerHighest,
              foreground: colors.onSurface,
            ),
          ),
          const SizedBox(width: 32),
        ],
      ),
    );
  }
}

class _StudentBubble extends StatelessWidget {
  const _StudentBubble({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          const SizedBox(width: 48),
          Flexible(child: _Bubble(text: text, background: colors.primary, foreground: colors.onPrimary)),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.text, required this.background, required this.foreground});

  final String text;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Text(text, style: TextStyle(color: foreground)),
      ),
    );
  }
}

class _TurnError extends StatelessWidget {
  const _TurnError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(message, style: TextStyle(color: Theme.of(context).colorScheme.error)),
      ),
    );
  }
}

class _CouldNotLoad extends StatelessWidget {
  const _CouldNotLoad({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Semantics(
              liveRegion: true,
              child: const Text(
                "The app can't reach Buddy right now. Check that the backend is running.",
                textAlign: TextAlign.center,
              ),
            ),
            const SizedBox(height: 12),
            TextButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}

class _Welcome extends StatelessWidget {
  const _Welcome();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const BuddyAvatar(radius: 36),
            const SizedBox(height: 16),
            Text(
              "Hi, I'm Buddy, an AI assistant. Ask me anything about life at Temple.",
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ],
        ),
      ),
    );
  }
}

class _Composer extends StatefulWidget {
  const _Composer({required this.chat});

  final ChatController chat;

  @override
  State<_Composer> createState() => _ComposerState();
}

class _ComposerState extends State<_Composer> {
  final _draft = TextEditingController();

  @override
  void dispose() {
    _draft.dispose();
    super.dispose();
  }

  void _send() {
    final text = _draft.text.trim();
    _draft.clear();
    widget.chat.send(text);
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: _draft,
                minLines: 1,
                maxLines: 4,
                keyboardType: TextInputType.multiline,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(labelText: 'Message Buddy', border: OutlineInputBorder()),
              ),
            ),
            const SizedBox(width: 8),
            ValueListenableBuilder(
              valueListenable: _draft,
              builder: (context, value, _) => IconButton.filled(
                icon: const Icon(Icons.send),
                tooltip: 'Send',
                onPressed: widget.chat.canSend && value.text.trim().isNotEmpty ? _send : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
