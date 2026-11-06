import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../backend/buddy_backend.dart';
import '../connections/connections_controller.dart';
import '../connections/connections_section.dart';
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
import '../tasks/task_backend.dart';
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

/// One of the places the conversation's menu leads to. Each one already has its own screen.
class MenuWay {
  const MenuWay({required this.icon, required this.title, this.subtitle, this.iconColor, this.iconTint, required this.open});

  final IconData icon;
  final String title;

  /// How it stands, in the same words as its row on the You tab.
  final String? subtitle;
  final Color? iconColor;
  final Color? iconTint;
  final VoidCallback open;
}

class BuddyTab extends StatefulWidget {
  const BuddyTab({
    super.key,
    required this.chat,
    required this.connections,
    required this.roadmap,
    required this.opportunities,
    required this.tasks,
    required this.openPhone,
    required this.openDraft,
    required this.menu,
    required this.openActivity,
  });

  final ChatController chat;
  final ConnectionsController connections;
  final RoadmapController roadmap;
  final OpportunitiesController opportunities;
  final TasksController tasks;
  final PhoneOpener openPhone;
  final DraftOpener openDraft;

  /// What the menu offers, worked out each time it opens, so that what each says is up to date.
  final List<MenuWay> Function() menu;

  /// Where tapping Buddy's face goes: the record of everything it read and did.
  final VoidCallback openActivity;

  @override
  State<BuddyTab> createState() => _BuddyTabState();
}

class _BuddyTabState extends State<BuddyTab> {
  final _wayDown = _WayDown();

  @override
  void dispose() {
    _wayDown.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chat = widget.chat;
    return ListenableBuilder(
      listenable: chat,
      builder: (context, _) => Column(
        children: [
          _Header(tasks: widget.tasks, connections: widget.connections, openPhone: widget.openPhone, menu: widget.menu, openActivity: widget.openActivity),
          Expanded(child: _body()),
          _Composer(chat: chat, wayDown: _wayDown),
        ],
      ),
    );
  }

  Widget _body() {
    final chat = widget.chat;
    if (chat.isLoading) {
      return const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading your conversation'));
    }
    if (chat.couldNotLoad) return _CouldNotLoad(onRetry: chat.loadHistory);
    return _MessageList(
      chat: chat,
      connections: widget.connections,
      roadmap: widget.roadmap,
      opportunities: widget.opportunities,
      tasks: widget.tasks,
      openPhone: widget.openPhone,
      openDraft: widget.openDraft,
      wayDown: _wayDown,
    );
  }
}

/// Whether the Student has scrolled far up the conversation, and how to take them back down. The way down sits just
/// above the box to write in, rather than over the conversation, so that it can never cover a card's buttons.
class _WayDown extends ChangeNotifier {
  bool _isFarUp = false;
  VoidCallback? goDown;

  bool get isFarUp => _isFarUp;

  set isFarUp(bool isFarUp) {
    if (isFarUp == _isFarUp) return;
    _isFarUp = isFarUp;
    notifyListeners();
  }

  /// For when the list itself goes. Nothing is told, because the screen is being rebuilt anyway.
  void forget() {
    goDown = null;
    _isFarUp = false;
  }
}

/// Buddy's face and name in the middle, the menu to its left, and under them what Buddy is doing or waiting on.
class _Header extends StatelessWidget {
  const _Header({required this.tasks, required this.connections, required this.openPhone, required this.menu, required this.openActivity});

  final TasksController tasks;
  final ConnectionsController connections;
  final PhoneOpener openPhone;
  final List<MenuWay> Function() menu;
  final VoidCallback openActivity;

  void _openMenu(BuildContext context) {
    final ways = menu();
    showBuddySheet<void>(
      context,
      title: 'Menu',
      children: (sheet) => [
        RowGroup(
          dividerIndent: RowGroup.indentPastIcon,
          children: [
            for (final way in ways)
              NavRow(
                icon: way.icon,
                iconColor: way.iconColor,
                iconTint: way.iconTint,
                title: way.title,
                subtitle: way.subtitle,
                onTap: () {
                  Navigator.of(sheet).pop();
                  way.open();
                },
              ),
          ],
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    // With large text or on a short screen, the face goes beside the name, so the conversation keeps its room.
    final compact = MediaQuery.textScalerOf(context).scale(10) > 13 || MediaQuery.sizeOf(context).height < 700;
    final name = [
      Text('Buddy', style: text.titleMedium),
      Text('Your Temple guide', textAlign: TextAlign.center, style: text.bodySmall?.copyWith(fontSize: 12, height: 1.3)),
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 2),
      // Only so large, because with large text every line it takes is one the conversation doesn't get.
      child: MediaQuery.withClampedTextScaling(
        maxScaleFactor: 1.3,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              crossAxisAlignment: compact ? CrossAxisAlignment.center : CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: EdgeInsets.only(top: compact ? 0 : 8),
                  child: IconButton(
                    style: IconButton.styleFrom(backgroundColor: BuddyColors.surface, side: const BorderSide(color: BuddyColors.frame)),
                    icon: const Icon(Icons.menu),
                    tooltip: 'Menu',
                    onPressed: () => _openMenu(context),
                  ),
                ),
                Expanded(
                  child: Semantics(
                    header: true,
                    button: true,
                    container: true,
                    label: 'Buddy, your Temple guide',
                    onTapHint: 'see what Buddy read and did',
                    onTap: openActivity,
                    excludeSemantics: true,
                    child: Center(
                      child: InkWell(
                        borderRadius: BorderRadius.circular(BuddySizes.chipRadius),
                        onTap: openActivity,
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(minHeight: BuddySizes.tapTarget),
                          child: Align(
                            widthFactor: 1,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                              child: compact
                                  ? Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        const BuddyAvatar(radius: 18),
                                        const SizedBox(width: 10),
                                        Flexible(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: name)),
                                      ],
                                    )
                                  : Column(mainAxisSize: MainAxisSize.min, children: [const BuddyAvatar(radius: 22), const SizedBox(height: 4), ...name]),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                // As wide as the menu button, so that Buddy's name sits in the middle of the screen.
                const SizedBox(width: BuddySizes.tapTarget),
              ],
            ),
            _StatusPill(tasks: tasks, connections: connections, openPhone: openPhone),
          ],
        ),
      ),
    );
  }
}

/// What the status pill says. Only what's true right now, and only what's worth a look: a Task that needs the Student,
/// a login Buddy is waiting for, or a Task under way.
class _Status {
  const _Status({required this.icon, required this.words, required this.aloud, required this.hint, required this.needsYou, required this.open});

  final IconData icon;
  final String words;
  final String aloud;

  /// What tapping it does, for a screen reader.
  final String hint;
  final bool needsYou;
  final void Function(BuildContext context) open;
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.tasks, required this.connections, required this.openPhone});

  final TasksController tasks;
  final ConnectionsController connections;
  final PhoneOpener openPhone;

  void _openTask(BuildContext context, Task task) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (context) => TaskScreen(id: task.id, tasks: tasks, openPhone: openPhone)));
  }

  /// What needs the Student comes before what doesn't. The newest Task comes first, as it does on Today.
  _Status? get _now {
    final onToday = tasks.onToday;
    if (onToday.where((task) => task.state == 'needs_student').firstOrNull case final task?) {
      return _Status(
        icon: Icons.pending_actions,
        words: 'Task needs you · ${task.title}',
        aloud: 'A Task needs you: ${task.title}',
        hint: 'see what it needs',
        needsYou: true,
        open: (context) => _openTask(context, task),
      );
    }
    final waiting = (connections.connections ?? const <Connection>[]).where((connection) => connection.needsLogin).toList();
    if (waiting.length == 1) {
      final connection = waiting.single;
      return _Status(
        icon: Icons.lock_outline,
        words: 'Login needed · ${connection.name}',
        aloud: 'Buddy is waiting for you to log in to ${connection.name}',
        hint: 'go to ${connection.name}',
        needsYou: true,
        open: (context) => Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (context) => ConnectionScreen(connectionId: connection.id, connections: connections)),
        ),
      );
    }
    if (waiting.length > 1) {
      return _Status(
        icon: Icons.lock_outline,
        words: 'Logins needed · ${waiting.length} Connections',
        aloud: 'Buddy is waiting for you to log in to ${waiting.length} Connections',
        hint: 'go to your Connections',
        needsYou: true,
        open: (context) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (context) => ConnectionsScreen(connections: connections))),
      );
    }
    if (onToday.where((task) => task.isWorking).firstOrNull case final task?) {
      return _Status(
        icon: Icons.autorenew,
        words: 'Task under way · ${task.title}',
        aloud: 'A Task is under way: ${task.title}',
        hint: 'see how it is going',
        needsYou: false,
        open: (context) => _openTask(context, task),
      );
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([tasks, connections]),
      builder: (context, _) {
        final status = _now;
        if (status == null) return const SizedBox(height: 4);
        final text = Theme.of(context).textTheme;
        return Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Semantics(
            button: true,
            container: true,
            label: status.aloud,
            onTapHint: status.hint,
            onTap: () => status.open(context),
            excludeSemantics: true,
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                customBorder: const StadiumBorder(),
                onTap: () => status.open(context),
                // The pill is smaller than a finger needs, so the space just above and below it can be tapped too.
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: DecoratedBox(
                    decoration: BoxDecoration(color: status.needsYou ? BuddyColors.warningTint : BuddyColors.quiet, borderRadius: BorderRadius.circular(BuddySizes.chipRadius)),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 40),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(status.icon, size: 16, color: status.needsYou ? BuddyColors.warningInk : BuddyColors.inkSoft),
                            const SizedBox(width: 7),
                            Flexible(
                              child: Text(
                                status.words,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: text.labelSmall?.copyWith(
                                  fontSize: 13,
                                  color: status.needsYou ? BuddyColors.warningInk : BuddyColors.inkSoft,
                                ),
                              ),
                            ),
                            const SizedBox(width: 4),
                            const Icon(Icons.chevron_right, size: 16, color: BuddyColors.inkSoft),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _MessageList extends StatefulWidget {
  const _MessageList({
    required this.chat,
    required this.connections,
    required this.roadmap,
    required this.opportunities,
    required this.tasks,
    required this.openPhone,
    required this.openDraft,
    required this.wayDown,
  });

  final ChatController chat;
  final ConnectionsController connections;
  final RoadmapController roadmap;
  final OpportunitiesController opportunities;
  final TasksController tasks;
  final PhoneOpener openPhone;
  final DraftOpener openDraft;
  final _WayDown wayDown;

  @override
  State<_MessageList> createState() => _MessageListState();
}

class _MessageListState extends State<_MessageList> {
  final _scroll = ScrollController();
  CrisisCardItem? _cardScrolledTo;
  ChatMessage? _sentScrolledTo;
  ActionCardItem? _tappedCardScrolledTo;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_noticeHowFarUp);
    widget.wayDown.goDown = _goToLatest;
  }

  @override
  void dispose() {
    // The list goes while the conversation reloads, and there's nothing far up to come back from then.
    if (widget.wayDown.goDown == _goToLatest) widget.wayDown.forget();
    _scroll.dispose();
    super.dispose();
  }

  void _noticeHowFarUp() {
    widget.wayDown.isFarUp = _scroll.hasClients && _scroll.offset > _showJumpBackAfter;
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

  /// Glides down, unless the Student has asked their phone to cut down on movement.
  void _goToLatest() {
    if (!_scroll.hasClients) return;
    if (MediaQuery.disableAnimationsOf(context)) {
      _scroll.jumpTo(0);
    } else {
      _scroll.animateTo(0, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
    }
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
    // Reversed, so the newest message stays at the bottom as the reply grows.
    return ListView.builder(
      controller: _scroll,
      reverse: true,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      itemCount: items.length,
      itemBuilder: (context, index) => items[index],
    );
  }
}

/// The way back down to the newest message, for a Student who has scrolled far up.
class _LatestMessages extends StatelessWidget {
  const _LatestMessages({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    // Its row has a set place above the box to write in, so its words only grow so far.
    return MediaQuery.withClampedTextScaling(
      maxScaleFactor: 1.6,
      child: OutlinedButton.icon(
        style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 18)),
        onPressed: onPressed,
        icon: const Icon(Icons.arrow_downward, size: 18),
        label: const Text('Latest messages', semanticsLabel: 'Go to the latest messages'),
      ),
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
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Center(
        child: DecoratedBox(
          decoration: BoxDecoration(color: BuddyColors.quiet, borderRadius: BorderRadius.circular(BuddySizes.chipRadius)),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            child: Text(_inWords(context), style: Theme.of(context).textTheme.labelSmall),
          ),
        ),
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
      padding: const EdgeInsets.only(top: 6, right: 24),
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
                  borderRadius: BorderRadius.circular(BuddySizes.pillRadius),
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
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        child: Row(
                          children: [
                            Icon(starter.icon, size: 20, color: BuddyColors.cherry),
                            const SizedBox(width: 12),
                            Expanded(child: Text(starter.label, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontSize: 15))),
                            const Icon(Icons.north_east, size: 18, color: BuddyColors.inkSoft),
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
            if (message.isFromBuddy) _BuddyBubble(text: message.text) else _StudentBubble(text: message.text),
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
      child: text.isEmpty ? const _BuddyBubble(child: _WritingDots()) : _BuddyBubble(text: text),
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
              padding: const EdgeInsets.only(right: 6, top: 7, bottom: 7),
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

/// Buddy's words, in a soft gray bubble on the left. The face and name at the top say who's speaking.
class _BuddyBubble extends StatelessWidget {
  const _BuddyBubble({this.text, this.child});

  final String? text;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Flexible(
            child: DecoratedBox(
              decoration: const BoxDecoration(
                color: BuddyColors.frame,
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(BuddySizes.bubbleRadius),
                  topRight: Radius.circular(BuddySizes.bubbleRadius),
                  bottomRight: Radius.circular(BuddySizes.bubbleRadius),
                  bottomLeft: Radius.circular(BuddySizes.bubbleTail),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: text == null ? child : Text(text!, style: Theme.of(context).textTheme.bodyLarge),
              ),
            ),
          ),
          const SizedBox(width: 24),
        ],
      ),
    );
  }
}

/// The Student's own words, on the right, in a light cherry bubble.
class _StudentBubble extends StatelessWidget {
  const _StudentBubble({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          const SizedBox(width: 48),
          Flexible(
            child: DecoratedBox(
              decoration: const BoxDecoration(
                color: BuddyColors.cherryBubble,
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(BuddySizes.bubbleRadius),
                  topRight: Radius.circular(BuddySizes.bubbleRadius),
                  bottomLeft: Radius.circular(BuddySizes.bubbleRadius),
                  bottomRight: Radius.circular(BuddySizes.bubbleTail),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Text(text, style: Theme.of(context).textTheme.bodyLarge),
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
  const _Composer({required this.chat, required this.wayDown});

  final ChatController chat;
  final _WayDown wayDown;

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
      child: ListenableBuilder(
        listenable: Listenable.merge([_draft, widget.wayDown]),
        builder: (context, _) {
          final typed = _draft.text;
          final canSend = widget.chat.canSend && typed.trim().isNotEmpty;
          final goDown = widget.wayDown.isFarUp ? widget.wayDown.goDown : null;
          return Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Where the shortcuts go, because far up the conversation they're no help, and here it covers nothing.
              if (goDown != null)
                Padding(padding: const EdgeInsets.only(top: 4), child: Center(child: _LatestMessages(onPressed: goDown)))
              else if (_showsShortcuts(context, typed))
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
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
                              avatar: Icon(starter.icon, size: 18, color: BuddyColors.cherry),
                              label: Text(starter.label),
                              onPressed: () => widget.chat.send(starter.words),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              // One white pill, with the box to write in and the send button at its end.
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 4, 14, 6),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: BuddyColors.surface,
                    borderRadius: BorderRadius.circular(BuddySizes.floatingRadius),
                    border: Border.all(
                      color: _focus.hasFocus ? BuddyColors.cherry : BuddyColors.hairline,
                      width: _focus.hasFocus ? 1.5 : 1,
                    ),
                    boxShadow: BuddyShadows.floating,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(4),
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
                            cursorColor: BuddyColors.cherry,
                            style: Theme.of(context).textTheme.bodyLarge,
                            decoration: const InputDecoration(
                              hintText: 'Message Buddy',
                              filled: false,
                              border: InputBorder.none,
                              enabledBorder: InputBorder.none,
                              focusedBorder: InputBorder.none,
                              contentPadding: EdgeInsets.fromLTRB(14, 12, 8, 12),
                            ),
                          ),
                        ),
                        IconButton.filled(
                          style: IconButton.styleFrom(
                            backgroundColor: BuddyColors.cherry,
                            foregroundColor: Colors.white,
                            disabledBackgroundColor: BuddyColors.frame,
                            disabledForegroundColor: BuddyColors.inkSoft,
                            minimumSize: const Size(BuddySizes.tapTarget, BuddySizes.tapTarget),
                          ),
                          icon: const Icon(Icons.arrow_upward),
                          tooltip: 'Send',
                          onPressed: canSend ? _send : null,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
