import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../backend/buddy_backend.dart';
import '../connections/connections_controller.dart';
import '../connections/read_permission_card.dart';
import '../design/parts.dart';
import '../design/theme.dart';
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
import '../tasks/task_card.dart';
import '../tasks/tasks_controller.dart';
import 'outlook.dart';

/// Ways in for a Student who doesn't know yet what to ask. They go into the conversation as if typed, so the Crisis
/// check and everything else treat them the same.
class _Starter {
  const _Starter(this.label, this.icon, this.words);

  final String label;
  final IconData icon;
  final String words;
}

const _starters = [
  _Starter('Understand a hold', Icons.description_outlined, 'Help me understand what a hold is, and whether I have one.'),
  _Starter('Plan my next week', Icons.calendar_today_outlined, 'Help me plan my next week.'),
  _Starter('Find someone to talk to', Icons.people_outline, 'Help me find the right person at Temple to talk to.'),
];

/// How far back a Crisis card keeps the cheerful shortcuts away. A plan for next week isn't what belongs under it.
const _itemsThatCountAsRecent = 10;

/// How far up the Student has to be for a way back down to be worth showing.
const _showJumpBackAfter = 400.0;

class BuddyTab extends StatelessWidget {
  const BuddyTab({super.key, required this.chat, required this.connections, required this.roadmap, required this.opportunities, required this.tasks, required this.openPhone, required this.openDraft});

  final ChatController chat;
  final ConnectionsController connections;
  final RoadmapController roadmap;
  final OpportunitiesController opportunities;
  final TasksController tasks;
  final PhoneOpener openPhone;
  final DraftOpener openDraft;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: chat,
      builder: (context, _) => Column(
        children: [
          const _Header(),
          const Divider(),
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
    return _MessageList(chat: chat, connections: connections, roadmap: roadmap, opportunities: opportunities, tasks: tasks, openPhone: openPhone, openDraft: openDraft);
  }
}

class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(BuddySizes.pageEdge, 12, BuddySizes.pageEdge, 12),
      // Only so large, because with large text every line it takes is one the conversation doesn't get.
      child: MediaQuery.withClampedTextScaling(
        maxScaleFactor: 1.3,
        child: Row(
          children: [
            const BuddyAvatar(radius: 24),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Semantics(header: true, container: true, child: Text('Buddy', style: text.headlineSmall)),
                  Text('Your Temple guide', style: text.bodySmall),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MessageList extends StatefulWidget {
  const _MessageList({required this.chat, required this.connections, required this.roadmap, required this.opportunities, required this.tasks, required this.openPhone, required this.openDraft});

  final ChatController chat;
  final ConnectionsController connections;
  final RoadmapController roadmap;
  final OpportunitiesController opportunities;
  final TasksController tasks;
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
  bool _isFarUp = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_noticeHowFarUp);
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _noticeHowFarUp() {
    final isFarUp = _scroll.hasClients && _scroll.offset > _showJumpBackAfter;
    if (isFarUp != _isFarUp) setState(() => _isFarUp = isFarUp);
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

  /// The list only learns how tall the newest items are once it has built them, and that can move it off the bottom
  /// again, so this goes on until it stays there. A few frames is all it takes, and too short to fight a Student's finger.
  void _scrollToBottomAfterFrame([int triesLeft = 8]) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients || _scroll.offset == 0) return;
      _scroll.jumpTo(0);
      if (triesLeft > 1) _scrollToBottomAfterFrame(triesLeft - 1);
    });
  }

  Widget _itemView(ConversationItem item) {
    final chat = widget.chat;
    return switch (item) {
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
      TaskCardItem() => TaskCard(
          // By the Task's number, because a card comes back as a new item when the conversation is loaded again.
          key: ValueKey('task-card-${item.task.id}'),
          task: item.task,
          tasks: widget.tasks,
          openPhone: widget.openPhone,
          announce: chat.newestTaskCards.any((newest) => identical(newest, item)),
        ),
    };
  }

  /// Cards arrive while Buddy is still writing, but its words introduce them, and a card under those words is the last
  /// thing on the screen, where the Student can act on it. So each reply goes above the cards that came with it. These are
  /// what's settled, and the cards still waiting for words to go under. A Crisis card goes first, ahead of any words.
  (List<ConversationItem>, List<ConversationItem>) _inReadingOrder() {
    final settled = <ConversationItem>[];
    var waiting = <ConversationItem>[];
    for (final item in widget.chat.items) {
      switch (item) {
        case ChatMessage(isFromBuddy: true):
          settled
            ..add(item)
            ..addAll(waiting);
          waiting = [];
        case ChatMessage() || CrisisCardItem():
          settled
            ..addAll(waiting)
            ..add(item);
          waiting = [];
        default:
          waiting.add(item);
      }
    }
    return (settled, waiting);
  }

  /// In reading order: each day starts with its date, then what happened that day.
  List<Widget> _withDays(List<ConversationItem> settled) {
    final widgets = <Widget>[];
    DateTime? day;
    for (final item in settled) {
      if (item case ChatMessage(sentAt: final sentAt?)) {
        final itsDay = DateUtils.dateOnly(sentAt.toLocal());
        if (itsDay != day) widgets.add(_DayDivider(day: itsDay));
        day = itsDay;
      }
      widgets.add(_itemView(item));
    }
    return widgets;
  }

  @override
  Widget build(BuildContext context) {
    final chat = widget.chat;
    _scrollToNewMessage();
    _scrollToNewCard();
    _scrollToTappedCard();
    final hasWritten = chat.items.any((item) => item is ChatMessage && !item.isFromBuddy);
    final (settled, waiting) = _inReadingOrder();
    final items = <Widget>[
      if (!hasWritten && chat.canSend) _StarterRows(chat: chat),
      if (chat.turnError case final error?) _TurnError(message: error),
      ...waiting.reversed.map(_itemView),
      if (chat.replyInProgress case final text?) _ReplyInProgress(text: text),
      ..._withDays(settled).reversed,
    ];
    return Stack(
      children: [
        // Reversed, so the newest message stays at the bottom as the reply grows.
        ListView.builder(
          controller: _scroll,
          reverse: true,
          padding: const EdgeInsets.fromLTRB(BuddySizes.pageEdge, 12, BuddySizes.pageEdge, 12),
          itemCount: items.length,
          itemBuilder: (context, index) => items[index],
        ),
        if (_isFarUp)
          Positioned(
            right: 16,
            bottom: 8,
            child: IconButton.outlined(
              style: IconButton.styleFrom(backgroundColor: BuddyColors.surface, side: const BorderSide(color: BuddyColors.hairline)),
              icon: const Icon(Icons.arrow_downward),
              tooltip: 'Go to the newest message',
              onPressed: () => _scroll.animateTo(0, duration: const Duration(milliseconds: 200), curve: Curves.easeOut),
            ),
          ),
      ],
    );
  }
}

/// The date between one day's messages and the next's.
class _DayDivider extends StatelessWidget {
  const _DayDivider({required this.day});

  final DateTime day;

  String _inWords(BuildContext context) {
    final today = DateUtils.dateOnly(DateTime.now());
    if (day == today) return 'Today';
    if (day == DateUtils.addDaysToDate(today, -1)) return 'Yesterday';
    return MaterialLocalizations.of(context).formatMediumDate(day);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          const Expanded(child: Divider()),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(_inWords(context), style: Theme.of(context).textTheme.bodySmall),
          ),
          const Expanded(child: Divider()),
        ],
      ),
    );
  }
}

/// A place to begin, under Buddy's first words. They go once the Student has written something.
class _StarterRows extends StatelessWidget {
  const _StarterRows({required this.chat});

  final ChatController chat;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, left: 44),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final starter in _starters)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Material(
                color: BuddyColors.surface,
                clipBehavior: Clip.antiAlias,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                  side: const BorderSide(color: BuddyColors.hairline),
                ),
                child: Semantics(
                  button: true,
                  container: true,
                  label: 'Ask Buddy: ${starter.label}',
                  onTap: () => chat.send(starter.words),
                  excludeSemantics: true,
                  child: InkWell(
                    onTap: () => chat.send(starter.words),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 52),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        child: Row(
                          children: [
                            Icon(starter.icon, size: 24, color: BuddyColors.ink),
                            const SizedBox(width: 14),
                            Expanded(child: Text(starter.label, style: Theme.of(context).textTheme.titleMedium)),
                            const Icon(Icons.chevron_right, color: BuddyColors.inkSoft),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _SavedMessage extends StatelessWidget {
  const _SavedMessage({required this.message, required this.announce});

  final ChatMessage message;
  final bool announce;

  Future<void> _copy(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await Clipboard.setData(ClipboardData(text: message.text));
      messenger.showSnackBar(const SnackBar(content: Text('Copied the message.')));
    } on Exception {
      messenger.showSnackBar(const SnackBar(content: Text("Buddy couldn't copy the message.")));
    }
  }

  @override
  Widget build(BuildContext context) {
    final speaker = message.isFromBuddy ? 'Buddy said' : 'You said';
    final note = message.hiddenNote;
    return Semantics(
      container: true,
      liveRegion: announce,
      label: note == null ? '$speaker: ${message.text}' : '$speaker: ${message.text}. $note',
      onLongPressHint: 'copy this message',
      onLongPress: () => _copy(context),
      excludeSemantics: true,
      child: GestureDetector(
        onLongPress: () => _copy(context),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            if (message.isFromBuddy) _BuddyMessage(text: message.text) else _StudentBubble(text: message.text),
            if (note != null)
              Padding(
                padding: const EdgeInsets.only(left: 48, bottom: 4),
                child: Text(note, textAlign: TextAlign.end, style: Theme.of(context).textTheme.bodySmall),
              ),
          ],
        ),
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
      child: text.isEmpty ? const _BuddyMessage(child: _WritingDots()) : _BuddyMessage(text: text),
    );
  }
}

/// Buddy is on it. It holds still for a Student who has asked their phone to cut down on movement.
class _WritingDots extends StatefulWidget {
  const _WritingDots();

  @override
  State<_WritingDots> createState() => _WritingDotsState();
}

class _WritingDotsState extends State<_WritingDots> with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _controller.stop();
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var dot = 0; dot < 3; dot++)
            Padding(
              padding: const EdgeInsets.only(right: 5, top: 8, bottom: 8),
              child: Opacity(
                // Each dot brightens a third of the way after the one before it.
                opacity: 0.3 + 0.7 * (1 - (((_controller.value * 3 - dot) % 3) - 1).abs()).clamp(0, 1),
                child: const DecoratedBox(
                  decoration: BoxDecoration(color: BuddyColors.inkSoft, shape: BoxShape.circle),
                  child: SizedBox.square(dimension: 8),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Buddy's words sit on the page rather than in a bubble, so that a long answer reads like something to read.
class _BuddyMessage extends StatelessWidget {
  const _BuddyMessage({this.text, this.child});

  final String? text;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const BuddyAvatar(radius: 16),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Buddy', style: style.titleSmall),
                const SizedBox(height: 2),
                if (text case final text?) Text(text, style: style.bodyLarge),
                ?child,
              ],
            ),
          ),
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
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          const SizedBox(width: 48),
          Flexible(
            child: DecoratedBox(
              decoration: BoxDecoration(color: BuddyColors.cherry, borderRadius: BorderRadius.circular(20)),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                child: Text(text, style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: Colors.white)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TurnError extends StatelessWidget {
  const _TurnError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: ProblemNote(message),
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
        child: EmptyState(
          icon: Icons.chat_bubble_outline,
          isProblem: true,
          words: "The app can't reach Buddy right now. Check that the backend is running.",
          action: AppLink('Try again', onPressed: onRetry),
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
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(_redraw);
  }

  @override
  void dispose() {
    _draft.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _redraw() => setState(() {});

  void _send() {
    final text = _draft.text.trim();
    _draft.clear();
    widget.chat.send(text);
  }

  /// Only when they'd help: not while the Student is writing or Buddy is replying, and not soon after a Crisis card.
  bool _showsShortcuts(BuildContext context, String typed) {
    final chat = widget.chat;
    if (!chat.canSend || _focus.hasFocus || typed.isNotEmpty) return false;
    // With large text the conversation needs the room more.
    if (MediaQuery.textScalerOf(context).scale(10) > 15) return false;
    final items = chat.items;
    if (!items.any((item) => item is ChatMessage && !item.isFromBuddy)) return false;
    return !items.reversed.take(_itemsThatCountAsRecent).any((item) => item is CrisisCardItem);
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      bottom: false,
      child: ValueListenableBuilder(
        valueListenable: _draft,
        builder: (context, value, _) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_showsShortcuts(context, value.text))
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  children: [
                    for (final starter in _starters)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: Semantics(
                          label: 'Ask Buddy: ${starter.label}',
                          button: true,
                          onTap: () => widget.chat.send(starter.words),
                          excludeSemantics: true,
                          child: ActionChip(
                            avatar: Icon(starter.icon, size: 18, color: BuddyColors.ink),
                            label: Text(starter.label),
                            onPressed: () => widget.chat.send(starter.words),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _draft,
                      focusNode: _focus,
                      minLines: 1,
                      maxLines: 4,
                      keyboardType: TextInputType.multiline,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(
                        hintText: 'Message Buddy',
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: const BorderSide(color: BuddyColors.outline)),
                        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: const BorderSide(color: BuddyColors.outline)),
                        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: const BorderSide(color: BuddyColors.cherry, width: 2)),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    style: IconButton.styleFrom(
                      backgroundColor: BuddyColors.cherry,
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: BuddyColors.hairline,
                      disabledForegroundColor: BuddyColors.inkSoft,
                      minimumSize: const Size(BuddySizes.tapTarget, BuddySizes.tapTarget),
                    ),
                    icon: const Icon(Icons.arrow_upward),
                    tooltip: 'Send',
                    onPressed: widget.chat.canSend && value.text.trim().isNotEmpty ? _send : null,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
