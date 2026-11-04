import 'package:flutter/material.dart';

import '../chat/crisis_card.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import '../widgets/work_in_progress.dart';
import 'add_milestone_screen.dart';
import 'goals_section.dart';
import 'milestone_screen.dart';
import 'organize_screen.dart';
import 'roadmap_backend.dart';
import 'roadmap_controller.dart';

/// The Student's own ordered list of Milestones. They can mark, add, remove and reorder any of them.
class RoadmapTab extends StatefulWidget {
  const RoadmapTab({super.key, required this.roadmap, required this.openPhone, required this.askBuddy});

  final RoadmapController roadmap;
  final PhoneOpener openPhone;

  /// Takes the Student to the conversation with these words sent, the same as if they'd typed them.
  final void Function(String words) askBuddy;

  @override
  State<RoadmapTab> createState() => _RoadmapTabState();
}

class _RoadmapTabState extends State<RoadmapTab> {
  void _openAddScreen(BuildContext context) {
    Navigator.of(context).push(MaterialPageRoute<void>(settings: workInProgress, builder: (context) => AddMilestoneScreen(roadmap: widget.roadmap)));
  }

  void _openGoals(BuildContext context) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (context) => GoalsScreen(roadmap: widget.roadmap, askBuddy: widget.askBuddy)));
  }

  void _openOrganize(BuildContext context) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (context) => OrganizeScreen(roadmap: widget.roadmap)));
  }

  void _openMilestone(BuildContext context, RoadmapMilestone milestone) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => MilestoneScreen(milestoneId: milestone.id, roadmap: widget.roadmap, openPhone: widget.openPhone),
      ),
    );
  }

  Widget _centered(Widget child) => LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          padding: const EdgeInsets.all(BuddySizes.pageEdge),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight - BuddySizes.pageEdge * 2),
            child: Center(child: child),
          ),
        ),
      );

  Widget _milestoneRow(BuildContext context, RoadmapMilestone milestone) => _MilestoneRow(
        // Keeps each row's state with its own Milestone as they move.
        key: ValueKey(milestone.id),
        milestone: milestone,
        roadmap: widget.roadmap,
        onTap: () => _openMilestone(context, milestone),
      );

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.roadmap,
      builder: (context, _) {
        final roadmap = widget.roadmap;
        final milestones = roadmap.milestones;
        if (roadmap.couldNotLoad) {
          return _centered(
            EmptyState(
              icon: Icons.map_outlined,
              isProblem: true,
              words: "Buddy couldn't load your Roadmap. Check that the backend is running.",
              action: AppLink('Try again', onPressed: roadmap.load),
            ),
          );
        }
        if (milestones == null) return const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading your Roadmap'));
        if (milestones.isEmpty) {
          final hasGoal = (roadmap.goals ?? const <Goal>[]).isNotEmpty;
          return _centered(
            EmptyState(
              icon: Icons.map_outlined,
              words: hasGoal
                  ? "You don't have a Roadmap yet. Buddy can propose one from your Goals, and nothing changes until you accept it."
                  : "You don't have a Roadmap yet. It starts with a Goal, and Buddy can help you choose one.",
              action: FilledButton(
                onPressed: () => widget.askBuddy(hasGoal ? 'Please make me a Roadmap.' : 'Help me choose a Goal.'),
                child: Text(hasGoal ? 'Ask Buddy for your Roadmap' : 'Choose a Goal with Buddy'),
              ),
            ),
          );
        }
        final toDo = milestones.where((milestone) => !milestone.done).toList();
        final done = milestones.where((milestone) => milestone.done).toList();
        final list = ListView(
          padding: const EdgeInsets.fromLTRB(BuddySizes.pageEdge, 16, BuddySizes.pageEdge, 24),
          children: [
            const PageTitle('Your Roadmap', subtitle: 'Yours to change.'),
            const SizedBox(height: 4),
            // A link across the page, because Goals are what the Roadmap is for.
            Semantics(
              button: true,
              container: true,
              label: 'Your Goals',
              onTap: () => _openGoals(context),
              excludeSemantics: true,
              child: InkWell(
                onTap: () => _openGoals(context),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Row(
                    children: [
                      Expanded(child: Text('Your Goals', style: Theme.of(context).textTheme.titleMedium?.copyWith(color: BuddyColors.link))),
                      const Icon(Icons.chevron_right, color: BuddyColors.inkSoft),
                    ],
                  ),
                ),
              ),
            ),
            const Divider(),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => _openAddScreen(context),
              icon: const Icon(Icons.add),
              label: const Text('Add a Milestone'),
            ),
            const SizedBox(height: 20),
            SectionTitle('Your Milestones', trailing: AppLink('Organize', semanticsLabel: 'Organize your Milestones', onPressed: () => _openOrganize(context))),
            if (toDo.isEmpty)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Text('Everything on your Roadmap is done. Add another, or ask Buddy what could come next.'),
              )
            else
              RowGroup(children: [for (final milestone in toDo) _milestoneRow(context, milestone)]),
            if (done.isNotEmpty) ...[
              const SizedBox(height: 12),
              Expander(
                icon: Icons.check_circle_outline,
                title: 'Completed',
                trailing: '${done.length}',
                children: [
                  for (final (index, milestone) in done.indexed) ...[
                    if (index > 0) const Divider(indent: 16, endIndent: 16),
                    _milestoneRow(context, milestone),
                  ],
                ],
              ),
            ],
            const SizedBox(height: 12),
            Text('You choose the order and the pace.', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: BuddyColors.inkSoft)),
          ],
        );
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Above the list, so that it's seen and read out from however far down the Student has scrolled.
            // With large text it can't take the whole screen, so it scrolls in its own third.
            if (roadmap.problem case final problem?)
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: BuddySizes.pageEdge),
                  child: ProblemNote(problem),
                ),
              ),
            Expanded(flex: 2, child: list),
          ],
        );
      },
    );
  }
}

/// A Milestone in the list: enough to know what it is and when, with done one tap away and the rest a tap further.
class _MilestoneRow extends StatelessWidget {
  const _MilestoneRow({super.key, required this.milestone, required this.roadmap, required this.onTap});

  final RoadmapMilestone milestone;
  final RoadmapController roadmap;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final name = milestone.name;
    final busy = roadmap.isChanging;
    final words = [
      milestone.badge,
      milestone.when,
      if (milestone.done) 'Done',
      if (milestone.sources.isEmpty) ?milestone.sourceNote,
    ];
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, top: 4),
          child: Checkbox(
            value: milestone.done,
            semanticLabel: 'Done: $name',
            onChanged: busy ? null : (done) => roadmap.setDone(milestone, done: done ?? false),
          ),
        ),
        Expanded(
          child: Semantics(
            button: true,
            container: true,
            label: 'Milestone: $name. ${words.map((line) => line.endsWith('.') ? line : '$line.').join(' ')}',
            onTap: onTap,
            excludeSemantics: true,
            child: InkWell(
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(4, 14, 12, 14),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(name, style: text.titleMedium?.copyWith(decoration: milestone.done ? TextDecoration.lineThrough : null)),
                          const SizedBox(height: 4),
                          Pill(milestone.goal?.text ?? 'Standard Milestone', tone: milestone.goal == null ? PillTone.quiet : PillTone.cherry),
                          const SizedBox(height: 4),
                          Text(milestone.when),
                          if (milestone.detail case final detail?)
                            Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Text(detail, maxLines: 2, overflow: TextOverflow.ellipsis),
                            ),
                          if (milestone.sources.isEmpty)
                            if (milestone.sourceNote case final note?)
                              Padding(padding: const EdgeInsets.only(top: 2), child: Text(note, style: text.bodySmall)),
                        ],
                      ),
                    ),
                    const SizedBox(width: 4),
                    const Icon(Icons.chevron_right, color: BuddyColors.inkSoft),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
