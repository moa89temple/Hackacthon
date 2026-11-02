import 'package:flutter/material.dart';

import 'roadmap_backend.dart';
import 'roadmap_controller.dart';
import 'source_link.dart';

/// The You tab's list of what the Student wants to achieve, with their controls over each one.
class GoalsSection extends StatelessWidget {
  const GoalsSection({super.key, required this.roadmap});

  final RoadmapController roadmap;

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
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(header: true, child: Text('Your Goals', style: Theme.of(context).textTheme.titleMedium)),
            const SizedBox(height: 8),
            if (goals == null || goals.isEmpty)
              const Text("You haven't set a Goal yet. Buddy can help you choose one.")
            else
              for (final goal in goals) _GoalRow(goal: goal, roadmap: roadmap),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: () => _add(context), child: const Text('Add a Goal')),
            if (roadmap.problem case final problem?) ProblemNote(problem),
          ],
        );
      },
    );
  }
}

class _GoalRow extends StatelessWidget {
  const _GoalRow({required this.goal, required this.roadmap});

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
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Remove')),
        ],
      ),
    );
    if (confirmed == true) await roadmap.removeGoal(goal);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(container: true, child: Text(goal.text)),
          Wrap(
            children: [
              TextButton(onPressed: roadmap.isChanging ? null : () => _edit(context), child: Text('Edit', semanticsLabel: 'Edit Goal: ${goal.text}')),
              TextButton(onPressed: roadmap.isChanging ? null : () => _remove(context), child: Text('Remove', semanticsLabel: 'Remove Goal: ${goal.text}')),
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
  late final _draft = TextEditingController(text: widget.text);

  @override
  void dispose() {
    _draft.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      scrollable: true,
      title: Text(widget.title),
      content: TextField(
        controller: _draft,
        autofocus: true,
        minLines: 1,
        maxLines: 3,
        textCapitalization: TextCapitalization.sentences,
        decoration: const InputDecoration(labelText: 'Goal', border: OutlineInputBorder()),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        ValueListenableBuilder(
          valueListenable: _draft,
          builder: (context, value, _) => TextButton(
            onPressed: value.text.trim().isEmpty ? null : () => Navigator.of(context).pop(_draft.text.trim()),
            child: const Text('Save'),
          ),
        ),
      ],
    );
  }
}
