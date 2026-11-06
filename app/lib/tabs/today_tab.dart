import 'package:flutter/material.dart';

import '../briefings/briefing_part.dart';
import '../briefings/briefings_controller.dart';
import '../chat/crisis_card.dart';
import '../connections/connections_controller.dart';
import '../connections/connections_section.dart';
import '../connections/login_request.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import '../guidebook/guidebook_controller.dart';
import '../guidebook/guidebook_screen.dart';
import '../milestones/milestone_card.dart';
import '../milestones/milestones_controller.dart';
import '../opportunities/opportunities_controller.dart';
import '../opportunities/opportunity_card.dart';
import '../roadmap/roadmap_controller.dart';
import '../tasks/task_backend.dart';
import '../tasks/task_card.dart';
import '../tasks/tasks_controller.dart';

const _shownAtATime = 5;
const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// What needs the Student today: what's waiting on them, then the latest Briefing, their Tasks, what they saved,
/// and the dates coming up, each from its Source.
class TodayTab extends StatefulWidget {
  const TodayTab({
    super.key,
    required this.briefings,
    required this.milestones,
    required this.opportunities,
    required this.tasks,
    required this.connections,
    required this.roadmap,
    required this.guidebook,
    required this.openPhone,
    required this.askBuddy,
    required this.openConversation,
    required this.openRoadmap,
    required this.refresh,
  });

  final BriefingsController briefings;
  final MilestonesController milestones;
  final OpportunitiesController opportunities;
  final TasksController tasks;

  /// Buddy asks here for any login it needs, because this is the tab the Student looks at each day.
  final ConnectionsController connections;
  final RoadmapController roadmap;
  final GuidebookController guidebook;
  final PhoneOpener openPhone;
  final void Function(String words) askBuddy;
  final VoidCallback openConversation;
  final VoidCallback openRoadmap;
  final Future<void> Function() refresh;

  @override
  State<TodayTab> createState() => _TodayTabState();
}

class _TodayTabState extends State<TodayTab> {
  int _shown = _shownAtATime;
  final _scroll = ScrollController();
  late int _timesAskedToShow = widget.briefings.timesAskedToShow;

  @override
  void initState() {
    super.initState();
    widget.briefings.addListener(_showBriefingIfAsked);
  }

  @override
  void dispose() {
    widget.briefings.removeListener(_showBriefingIfAsked);
    _scroll.dispose();
    super.dispose();
  }

  /// A tapped notification should find the Briefing on the screen, wherever the Student left the list.
  void _showBriefingIfAsked() {
    if (widget.briefings.timesAskedToShow == _timesAskedToShow) return;
    _timesAskedToShow = widget.briefings.timesAskedToShow;
    if (_scroll.hasClients) _scroll.jumpTo(0);
  }

  void _openGuidebook({GuidebookShelf shelf = GuidebookShelf.resources}) => openGuidebook(
        context,
        guidebook: widget.guidebook,
        opportunities: widget.opportunities,
        openPhone: widget.openPhone,
        askBuddy: widget.askBuddy,
        shelf: shelf,
      );

  void _openTask(Task task) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => TaskScreen(
          id: task.id,
          tasks: widget.tasks,
          openPhone: widget.openPhone,
          openConversation: widget.openConversation,
        ),
      ),
    );
  }

  void _openConnections() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (context) => ConnectionsScreen(connections: widget.connections)),
    );
  }

  String get _dateLine {
    final now = philadelphiaNow(DateTime.now());
    return '${_weekdays[now.weekday - 1]}, ${_months[now.month - 1]} ${now.day} · Philadelphia time';
  }

  /// What's waiting on the Student and what they're keeping track of, counted from what this tab has already loaded.
  /// Nothing that hasn't loaded is counted, so the line never says there's nothing when it doesn't know.
  String? get _counts {
    final tasks = widget.tasks.hasLoaded ? widget.tasks.onToday : null;
    final logins = widget.connections.connections?.where((connection) => connection.needsLogin).length;
    final needYou = tasks?.where((task) => task.state == 'needs_student').length;
    final underWay = tasks?.where((task) => task.isWorking).length;
    final toDo = widget.roadmap.milestones?.where((milestone) => !milestone.done).length;
    final saved = widget.opportunities.all == null ? null : widget.opportunities.saved.length;
    String count(int number, String one, String many) => '$number ${number == 1 ? one : many}';
    final parts = [
      if (logins case final number? when number > 0) count(number, 'login waiting', 'logins waiting'),
      if (needYou case final number? when number > 0) count(number, 'Task needs you', 'Tasks need you'),
      if (underWay case final number? when number > 0) count(number, 'Task under way', 'Tasks under way'),
      if (toDo case final number? when number > 0) count(number, 'Milestone to do', 'Milestones to do'),
      if (saved case final number? when number > 0) count(number, 'saved Opportunity', 'saved Opportunities'),
    ];
    if (parts.isEmpty) return logins == 0 && needYou == 0 ? 'Nothing is waiting on you right now.' : null;
    final allButLast = parts.sublist(0, parts.length - 1);
    return allButLast.isEmpty ? '${parts.last}.' : '${allButLast.join(', ')} and ${parts.last}.';
  }

  /// A Task waiting on the Student comes before everything else that doesn't have a clock on it.
  List<Widget> _waitingTasks() {
    return [
      for (final task in widget.tasks.onToday.where((task) => task.state == 'needs_student')) ...[
        NoticeCard(
          icon: Icons.pending_actions,
          title: task.title,
          words: task.stateText,
          action: OutlinedButton(
            style: OutlinedButton.styleFrom(foregroundColor: BuddyColors.cherry),
            onPressed: () => _openTask(task),
            child: Text('See what it needs', semanticsLabel: 'See what this Task needs: ${task.title}'),
          ),
        ),
        const SizedBox(height: 12),
      ],
    ];
  }

  List<Widget> _tasksPart(BuildContext context) {
    final tasks = widget.tasks.onToday.where((task) => task.state != 'needs_student').toList();
    if (tasks.isEmpty) return const [];
    return [
      const SectionTitle('Tasks'),
      RowGroup(
        dividerIndent: RowGroup.indentPastIcon,
        children: [for (final task in tasks) TaskRow(key: ValueKey('task ${task.id}'), task: task, onTap: () => _openTask(task))],
      ),
      const SizedBox(height: 28),
    ];
  }

  List<Widget> _savedPart(BuildContext context) {
    final saved = widget.opportunities.saved;
    return [
      if (saved.isNotEmpty) ...[
        const SectionTitle('Saved Opportunities'),
        RowGroup(
          children: [
            for (final opportunity in saved)
              OpportunityCard(
                // Keeps each card's state with its own Opportunity as the list changes around it.
                key: ValueKey('opportunity ${opportunity.id}'),
                opportunity: opportunity,
                opportunities: widget.opportunities,
                openPhone: widget.openPhone,
                inGroup: true,
              ),
          ],
        ),
        const SizedBox(height: 4),
      ],
      Align(
        alignment: AlignmentDirectional.centerStart,
        child: AppLink('See Opportunities', onPressed: () => _openGuidebook(shelf: GuidebookShelf.opportunities)),
      ),
      const SizedBox(height: 24),
    ];
  }

  /// What's left of setting Buddy up, in the place it's needed. Each one goes once it's done, and so does the group.
  List<Widget> _startPart(BuildContext context) {
    final goals = widget.roadmap.goals;
    final milestones = widget.roadmap.milestones;
    final connections = widget.connections.connections;
    if (goals == null || milestones == null || connections == null) return const [];
    final rows = [
      if (goals.isEmpty)
        NavRow(
          icon: Icons.flag_outlined,
          title: 'Choose a Goal',
          subtitle: 'Tell Buddy what you want from your time at Temple.',
          onTap: () => widget.askBuddy('Help me choose a Goal.'),
        ),
      if (!connections.any((connection) => connection.on))
        NavRow(
          icon: Icons.link,
          title: 'Connect a Temple system',
          subtitle: 'So Buddy can tell you what is due. Nothing is read until you say yes.',
          onTap: _openConnections,
        ),
      if (goals.isNotEmpty && milestones.isEmpty)
        NavRow(
          icon: Icons.map_outlined,
          title: 'Build your Roadmap',
          subtitle: 'Buddy proposes one from your Goals, and you decide.',
          onTap: widget.openRoadmap,
        ),
    ];
    if (rows.isEmpty) return const [];
    return [
      const SectionTitle('Get started'),
      RowGroup(dividerIndent: RowGroup.indentPastIcon, children: rows),
      const SizedBox(height: 28),
    ];
  }

  List<Widget> _comingUp(BuildContext context) {
    if (widget.milestones.couldNotLoad) {
      return [
        EmptyState(
          icon: Icons.calendar_today_outlined,
          words: "Buddy couldn't load what's coming up. Check that the backend is running.",
          isProblem: true,
          action: AppLink('Try again', onPressed: widget.milestones.load),
        ),
      ];
    }
    final upcoming = widget.milestones.upcoming;
    if (upcoming == null) return const [LoadingBlock()];
    if (upcoming.isEmpty) {
      return const [
        EmptyState(
          icon: Icons.calendar_today_outlined,
          words: "No dates to show yet. Buddy reads Temple's calendar and deadline pages each day, and what's coming up will show here.",
        ),
      ];
    }
    final shown = upcoming.take(_shown).toList();
    final more = upcoming.length - shown.length;
    final nextBatch = more < _shownAtATime ? more : _shownAtATime;
    return [
      const SectionTitle('Coming up'),
      Text('Dates every Temple Student faces, from the registrar and Student Financial Services.', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: BuddyColors.inkSoft)),
      const SizedBox(height: 12),
      RowGroup(
        dividerIndent: RowGroup.indentPastIcon,
        children: [
          for (final milestone in shown)
            // Keeps each card's state with its own date as the list changes around it.
            MilestoneCard(key: ValueKey(milestone.id), milestone: milestone, openPhone: widget.openPhone, inGroup: true),
        ],
      ),
      if (more > 0)
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: AppLink(
            'Show $nextBatch more',
            semanticsLabel: 'Show $nextBatch more ${nextBatch == 1 ? 'date' : 'dates'}',
            onPressed: () => setState(() => _shown += _shownAtATime),
          ),
        ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([widget.briefings, widget.milestones, widget.opportunities, widget.tasks, widget.roadmap, widget.connections]),
      builder: (context, _) => RefreshIndicator(
        color: BuddyColors.cherry,
        onRefresh: widget.refresh,
        child: ListView(
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(BuddySizes.pageEdge, 16, BuddySizes.pageEdge, 24),
          children: [
            PageTitle(
              'Today',
              subtitle: _dateLine,
              trailing: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 16)),
                onPressed: _openGuidebook,
                icon: const Icon(Icons.menu_book_outlined, size: 18),
                label: const Text('Guidebook'),
              ),
            ),
            const SizedBox(height: 18),
            _Welcome(counts: _counts, onPlan: () => widget.askBuddy('Help me plan my day.')),
            const SizedBox(height: 24),
            LoginRequests(connections: widget.connections),
            ..._waitingTasks(),
            ...briefingPart(
              context,
              briefings: widget.briefings,
              opportunities: widget.opportunities,
              openPhone: widget.openPhone,
              openRoadmap: widget.openRoadmap,
            ),
            ..._tasksPart(context),
            ..._savedPart(context),
            ..._startPart(context),
            ..._comingUp(context),
          ],
        ),
      ),
    );
  }
}

/// The top of Today: a few friendly words of Buddy's own, what's waiting in plain counts, and the way to plan the day
/// with Buddy. The words are written here, so they're the same every day and nothing in them is made up.
class _Welcome extends StatelessWidget {
  const _Welcome({required this.counts, required this.onPlan});

  final String? counts;
  final VoidCallback onPlan;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return DecoratedBox(
      decoration: BoxDecoration(color: BuddyColors.cherryTint, borderRadius: BorderRadius.circular(BuddySizes.cardRadius)),
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // A screen reader gets the words as written, not spelled out.
            Semantics(
              container: true,
              label: 'Your day at Temple',
              excludeSemantics: true,
              child: Row(
                children: [
                  const Icon(Icons.wb_sunny_outlined, size: 16, color: BuddyColors.cherry),
                  const SizedBox(width: 7),
                  Flexible(child: Text('YOUR DAY AT TEMPLE', style: text.labelMedium?.copyWith(color: BuddyColors.cherry))),
                ],
              ),
            ),
            const SizedBox(height: 12),
            // A greeting, so it only grows so far, and what's below it keeps its room.
            MediaQuery.withClampedTextScaling(
              maxScaleFactor: 1.4,
              child: Text("Let's take today one step at a time.", style: text.headlineLarge),
            ),
            if (counts case final counts?) ...[
              const SizedBox(height: 10),
              Semantics(container: true, child: Text(counts, style: text.bodyMedium?.copyWith(color: BuddyColors.inkSoft))),
            ],
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: onPlan,
              icon: const Icon(Icons.chat_bubble_outline, size: 18),
              label: const Text('Plan my day', semanticsLabel: 'Plan my day with Buddy'),
            ),
          ],
        ),
      ),
    );
  }
}
