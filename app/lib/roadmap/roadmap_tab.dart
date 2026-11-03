import 'package:flutter/material.dart';

import '../chat/crisis_card.dart';
import '../widgets/work_in_progress.dart';
import 'add_milestone_screen.dart';
import 'roadmap_backend.dart';
import 'roadmap_controller.dart';
import 'roadmap_parts.dart';

const _calendarHost = 'calendar.google.com';

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
  String? _phoneProblem;

  Future<void> _open(Uri address) async {
    bool opened;
    try {
      opened = await widget.openPhone(address);
    } on Exception {
      opened = false;
    }
    if (mounted) setState(() => _phoneProblem = opened ? null : couldNotOpen);
  }

  Widget _message(BuildContext context, String words, {Widget? action, bool isProblem = false}) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ExcludeSemantics(child: Icon(Icons.map, size: 48, color: Theme.of(context).colorScheme.primary)),
            const SizedBox(height: 16),
            Semantics(container: true, liveRegion: isProblem, child: Text(words, textAlign: TextAlign.center)),
            const SizedBox(height: 12),
            ?action,
          ],
        ),
      ),
    );
  }

  void _openAddScreen(BuildContext context) {
    Navigator.of(context).push(MaterialPageRoute<void>(settings: workInProgress, builder: (context) => AddMilestoneScreen(roadmap: widget.roadmap)));
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.roadmap,
      builder: (context, _) {
        final roadmap = widget.roadmap;
        final milestones = roadmap.milestones;
        if (roadmap.couldNotLoad) {
          return _message(
            context,
            "Buddy couldn't load your Roadmap. Check that the backend is running.",
            isProblem: true,
            action: TextButton(onPressed: roadmap.load, child: const Text('Try again')),
          );
        }
        if (milestones == null) return const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading your Roadmap'));
        if (milestones.isEmpty) {
          final hasGoal = (roadmap.goals ?? const <Goal>[]).isNotEmpty;
          return _message(
            context,
            hasGoal
                ? "You don't have a Roadmap yet. Buddy can propose one from your Goals, and nothing changes until you accept it."
                : "You don't have a Roadmap yet. It starts with a Goal, and Buddy can help you choose one.",
            action: OutlinedButton(
              onPressed: () => widget.askBuddy(hasGoal ? 'Please make me a Roadmap.' : 'Help me choose a Goal.'),
              child: Text(hasGoal ? 'Ask Buddy for your Roadmap' : 'Choose a Goal with Buddy'),
            ),
          );
        }
        final problem = roadmap.problem ?? _phoneProblem;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Above the list, so that it's seen and read out from however far down the Student has scrolled.
            // With large text it can't take the whole screen, so it scrolls in its own third.
            if (problem != null)
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: ProblemNote(problem),
                ),
              ),
            Expanded(
              flex: 2,
              child: ListView.builder(
                padding: const EdgeInsets.all(12),
                // The heading goes first, then each Milestone, so that a long list doesn't build all at once.
                itemCount: milestones.length + 1,
                itemBuilder: (context, index) {
                  if (index == 0) return _header(context);
                  final milestone = milestones[index - 1];
                  return _MilestoneRow(
                    // Keeps each row's state with its own Milestone as they move.
                    key: ValueKey(milestone.id),
                    milestone: milestone,
                    place: index,
                    total: milestones.length,
                    roadmap: roadmap,
                    open: _open,
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _header(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(header: true, child: Text('Your Roadmap', style: Theme.of(context).textTheme.titleLarge)),
        const SizedBox(height: 4),
        const Text('Yours to change. Mark what you\'ve done, and add, remove or move anything.'),
        const SizedBox(height: 8),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: OutlinedButton(onPressed: () => _openAddScreen(context), child: const Text('Add a Milestone')),
        ),
      ],
    );
  }
}

class _MilestoneRow extends StatelessWidget {
  const _MilestoneRow({super.key, required this.milestone, required this.place, required this.total, required this.roadmap, required this.open});

  final RoadmapMilestone milestone;
  final int place;
  final int total;
  final RoadmapController roadmap;
  final void Function(Uri address) open;

  Uri? get _calendarAddress {
    final address = Uri.tryParse(milestone.calendarUrl);
    return address?.scheme == 'https' && address?.host == _calendarHost ? address : null;
  }

  Future<void> _remove(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: const Text('Remove this Milestone?'),
        content: Text(milestone.name),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Remove')),
        ],
      ),
    );
    if (confirmed == true) await roadmap.remove(milestone);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final calendar = _calendarAddress;
    final busy = roadmap.isChanging;
    final name = milestone.name;
    final gone = milestone.goneFromSource ? "Buddy no longer finds this date, because it's gone from its Source. This is what it last said." : null;
    final words = [
      milestone.badge,
      milestone.when,
      if (milestone.done) 'Done',
      ?gone,
      ?milestone.detail?.replaceAll('\n', ' '),
      if (milestone.sources.isEmpty) ?milestone.sourceNote,
    ];
    return Card(
      // It holds controls as well as words, so it's a set of separate nodes rather than one.
      semanticContainer: false,
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // One item, because on Android its lines otherwise run together with the buttons'.
            Semantics(
              container: true,
              label: 'Milestone $place of $total: $name. ${words.map((line) => line.endsWith('.') ? line : '$line.').join(' ')}',
              excludeSemantics: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: theme.textTheme.titleMedium?.copyWith(decoration: milestone.done ? TextDecoration.lineThrough : null),
                  ),
                  const SizedBox(height: 2),
                  Text(milestone.badge, style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary)),
                  Text(milestone.when),
                  if (milestone.done) const Text('Done'),
                  if (gone != null) Text(gone, style: theme.textTheme.bodySmall),
                  if (milestone.detail case final detail?)
                    Padding(padding: const EdgeInsets.only(top: 4), child: Text(detail, style: theme.textTheme.bodySmall)),
                  if (milestone.sources.isEmpty)
                    if (milestone.sourceNote case final note?)
                      Padding(padding: const EdgeInsets.only(top: 4), child: Text(note, style: theme.textTheme.bodySmall)),
                ],
              ),
            ),
            for (final source in milestone.sources) SourceButton(source: source, open: open),
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Checkbox(
                  value: milestone.done,
                  semanticLabel: 'Done: $name',
                  onChanged: busy ? null : (done) => roadmap.setDone(milestone, done: done ?? false),
                ),
                IconButton(
                  icon: const Icon(Icons.arrow_upward),
                  tooltip: 'Move up: $name',
                  onPressed: busy || place == 1 ? null : () => roadmap.move(milestone, by: -1),
                ),
                IconButton(
                  icon: const Icon(Icons.arrow_downward),
                  tooltip: 'Move down: $name',
                  onPressed: busy || place == total ? null : () => roadmap.move(milestone, by: 1),
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  tooltip: 'Remove: $name',
                  onPressed: busy ? null : () => _remove(context),
                ),
              ],
            ),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton(
                onPressed: calendar == null ? null : () => open(calendar),
                child: Text('Add to Google Calendar', semanticsLabel: 'Add to Google Calendar: $name'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
