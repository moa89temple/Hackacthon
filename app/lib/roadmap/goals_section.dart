import 'package:flutter/material.dart';

import '../design/parts.dart';
import '../design/theme.dart';
import 'roadmap_backend.dart';
import 'roadmap_controller.dart';

/// What the Student wants to achieve, with their controls over each one.
class GoalsScreen extends StatelessWidget {
  const GoalsScreen({super.key, required this.roadmap, required this.askBuddy});

  final RoadmapController roadmap;
  final void Function(String words) askBuddy;

  Future<void> _add(BuildContext context) async {
    final text = await showDialog<String>(context: context, builder: (context) => const _GoalDialog(title: 'Add a Goal', text: ''));
    if (text != null) await roadmap.addGoal(text);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: roadmap,
      builder: (context, _) {
        final goals = roadmap.goals;
        return SubScreen(
          title: 'Your Goals',
          subtitle: 'What you want from your time at Temple. Your Roadmap is built from these.',
          children: [
            if (goals == null || goals.isEmpty)
              EmptyState(
                icon: Icons.track_changes,
                words: "You haven't set a Goal yet. Buddy can help you choose one.",
                action: OutlinedButton(onPressed: () => askBuddy('Help me choose a Goal.'), child: const Text('Choose a Goal with Buddy')),
              )
            else
              RowGroup(children: [for (final goal in goals) _GoalRow(key: ValueKey('goal ${goal.id}'), goal: goal, roadmap: roadmap)]),
            const SizedBox(height: 12),
            OutlinedButton.icon(onPressed: () => _add(context), icon: const Icon(Icons.add), label: const Text('Add a Goal')),
            if (roadmap.problem case final problem?) ProblemNote(problem),
          ],
        );
      },
    );
  }
}

class _GoalRow extends StatelessWidget {
  const _GoalRow({super.key, required this.goal, required this.roadmap});

  final Goal goal;
  final RoadmapController roadmap;

  Future<void> _edit(BuildContext context) async {
    final text = await showDialog<String>(context: context, builder: (context) => _GoalDialog(title: 'Change this Goal', text: goal.text));
    if (text != null && text != goal.text) await roadmap.editGoal(goal, text);
  }

  String get _whatGoesWithIt {
    final count = (roadmap.milestones ?? const <RoadmapMilestone>[]).where((milestone) => milestone.goal?.id == goal.id).length;
    return switch (count) {
      0 => goal.text,
      1 => '${goal.text}\n\n1 Milestone on your Roadmap goes with it.',
      _ => '${goal.text}\n\n$count Milestones on your Roadmap go with it.',
    };
  }

  Future<void> _remove(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: const Text('Remove this Goal?'),
        content: Text(_whatGoesWithIt),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: BuddyColors.problem),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed == true) await roadmap.removeGoal(goal);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 4, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Semantics(container: true, child: Text(goal.text, style: Theme.of(context).textTheme.titleMedium)),
            ),
          ),
          RowMenu(
            tooltip: 'Change or remove Goal: ${goal.text}',
            enabled: !roadmap.isChanging,
            items: [
              RowMenuItem('Edit', semanticsLabel: 'Edit Goal: ${goal.text}', onSelected: () => _edit(context)),
              RowMenuItem('Remove', semanticsLabel: 'Remove Goal: ${goal.text}', onSelected: () => _remove(context)),
            ],
          ),
        ],
      ),
    );
  }
}

class _GoalDialog extends StatefulWidget {
  const _GoalDialog({required this.title, required this.text});

  final String title;
  final String text;

  @override
  State<_GoalDialog> createState() => _GoalDialogState();
}

class _GoalDialogState extends State<_GoalDialog> {
  late final _words = TextEditingController(text: widget.text);

  @override
  void dispose() {
    _words.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      scrollable: true,
      title: Text(widget.title),
      content: TextField(
        controller: _words,
        autofocus: true,
        minLines: 1,
        maxLines: 3,
        textCapitalization: TextCapitalization.sentences,
        decoration: const InputDecoration(labelText: 'Goal'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        ValueListenableBuilder(
          valueListenable: _words,
          builder: (context, value, _) => TextButton(
            onPressed: value.text.trim().isEmpty ? null : () => Navigator.of(context).pop(_words.text.trim()),
            child: const Text('Save'),
          ),
        ),
      ],
    );
  }
}
