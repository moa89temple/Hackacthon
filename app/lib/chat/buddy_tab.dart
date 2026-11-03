import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../connections/connections_controller.dart';
import '../connections/read_permission_card.dart';
import 'action_card.dart';
import '../widgets/buddy_avatar.dart';
import 'chat_controller.dart';
import 'crisis_card.dart';
import 'draft_card.dart';
import 'guidebook_card.dart';
import '../milestones/milestone_card.dart';
import '../opportunities/opportunities_controller.dart';
import '../opportunities/opportunity_card.dart';
import '../roadmap/roadmap_card.dart';
import '../roadmap/roadmap_controller.dart';
import 'outlook.dart';

class BuddyTab extends StatelessWidget {
  const BuddyTab({super.key, required this.chat, required this.connections, required this.roadmap, required this.opportunities, required this.openPhone, required this.openDraft});

  final ChatController chat;
  final ConnectionsController connections;
  final RoadmapController roadmap;
  final OpportunitiesController opportunities;
  final PhoneOpener openPhone;
  final DraftOpener openDraft;

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
    return _MessageList(chat: chat, connections: connections, roadmap: roadmap, opportunities: opportunities, openPhone: openPhone, openDraft: openDraft);
  }
}

class _MessageList extends StatefulWidget {
  const _MessageList({required this.chat, required this.connections, required this.roadmap, required this.opportunities, required this.openPhone, required this.openDraft});

  final ChatController chat;
  final ConnectionsController connections;
  final RoadmapController roadmap;
  final OpportunitiesController opportunities;
  final PhoneOpener openPhone;
  final DraftOpener openDraft;

  @override
  State<_MessageList> createState() => _MessageListState();
}

class _MessageListState extends State<_MessageList> {
  final _scroll = ScrollController();
  CrisisCardItem? _cardScrolledTo;
  ChatMessage? _sentScrolledTo;
  ActionCardItem? _tappedCardScrolledTo;

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  /// A new Crisis card must not appear somewhere the Student has scrolled away from.
  void _scrollToNewCard() {
    final card = widget.chat.newestCard;
    if (card == null || identical(card, _cardScrolledTo)) return;
    _cardScrolledTo = card;
    _scrollToBottomAfterFrame();
  }

  /// Sending takes the Student to their message, once. The list stays anchored to its bottom from
  /// there, so the reply stays in view as it grows, and if they scroll up to read they stay put.
  void _scrollToNewMessage() {
    final sent = widget.chat.newestSent;
    if (sent == null || identical(sent, _sentScrolledTo)) return;
    _sentScrolledTo = sent;
    _scrollToBottomAfterFrame();
  }

  /// A card the Student has just asked for with a tap is what they're waiting to see.
  void _scrollToTappedCard() {
    final card = widget.chat.newestTappedCard;
    if (card == null || identical(card, _tappedCardScrolledTo)) return;
    _tappedCardScrolledTo = card;
    _scrollToBottomAfterFrame();
  }

  void _scrollToBottomAfterFrame() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(0);
    });
  }

  @override
  Widget build(BuildContext context) {
    final chat = widget.chat;
    _scrollToNewMessage();
    _scrollToNewCard();
    _scrollToTappedCard();
    final items = <Widget>[
      if (chat.turnError case final error?) _TurnError(message: error),
      if (chat.replyInProgress case final text?) _ReplyInProgress(text: text),
      for (final item in chat.items.reversed)
        switch (item) {
          ChatMessage() => _SavedMessage(
              message: item,
              announce: identical(item, chat.newestReply) || identical(item, chat.newestHidden),
            ),
          CrisisCardItem() => CrisisCard(
              // Keeps its state with its own item as the list changes around it.
              key: ObjectKey(item),
              item: item,
              chat: chat,
              announce: identical(item, chat.newestCard),
              openPhone: widget.openPhone,
            ),
          ReadPermissionCardItem() => ConversationReadPermissionCard(
              connectionId: item.connectionId,
              connections: widget.connections,
              announce: identical(item, chat.newestReadPermissionCard),
            ),
          GuidebookCardItem() => GuidebookCard(
              // Keeps each card's state with its own item as the list changes around it.
              key: ObjectKey(item),
              card: item,
              chat: chat,
              openPhone: widget.openPhone,
              announce: chat.newestGuidebookCards.any((newest) => identical(newest, item)),
            ),
          ActionCardItem() => ActionCardView(
              // By the card's id, because the item is replaced each time the card changes.
              key: ValueKey('action-card-${item.card.id}'),
              card: item.card,
              chat: chat,
              openPhone: widget.openPhone,
              announce: chat.newestActionCards.any((newest) => identical(newest, item)),
            ),
          DraftCardItem() => DraftCard(
              // By number, because an edit replaces the item and what the card has just said should stay.
              key: ValueKey('draft ${item.draft.id}'),
              card: item,
              chat: chat,
              openDraft: widget.openDraft,
              announce: identical(item, chat.newestDraftCard),
            ),
          MilestoneCardItem(milestone: final milestone?) => MilestoneCard(
              // Keeps each card's state with its own item as the list changes around it.
              key: ObjectKey(item),
              milestone: milestone,
              openPhone: widget.openPhone,
              announce: chat.newestMilestoneCards.any((newest) => identical(newest, item)),
            ),
          MilestoneCardItem() => const GoneMilestoneNote(),
          OpportunityCardItem(opportunity: final opportunity?) => OpportunityCard(
              // Keeps each card's state with its own item as the list changes around it.
              key: ObjectKey(item),
              opportunity: opportunity,
              opportunities: widget.opportunities,
              openPhone: widget.openPhone,
              announce: chat.newestOpportunityCards.any((newest) => identical(newest, item)),
            ),
          OpportunityCardItem() => const GoneOpportunityNote(),
          RoadmapCardItem() => RoadmapCardView(
              // By the card's number, because the item is replaced each time the card changes.
              key: ValueKey('roadmap-card-${item.card.id}'),
              card: item.card,
              chat: chat,
              roadmap: widget.roadmap,
              openPhone: widget.openPhone,
              announce: chat.newestRoadmapCards.any((newest) => identical(newest, item)),
            ),
        },
    ];
    // Reversed, so the newest message stays at the bottom as the reply grows.
    return ListView.builder(
      controller: _scroll,
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
    final note = message.hiddenNote;
    return Semantics(
      container: true,
      liveRegion: announce,
      label: note == null ? '$speaker: ${message.text}' : '$speaker: ${message.text}. $note',
      excludeSemantics: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (message.isFromBuddy) _BuddyBubble(text: message.text) else _StudentBubble(text: message.text),
          if (note != null)
            Padding(
              padding: const EdgeInsets.only(left: 48, bottom: 4),
              child: Text(note, textAlign: TextAlign.end, style: Theme.of(context).textTheme.bodySmall),
            ),
        ],
      ),
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
