import 'package:flutter/material.dart';

import 'roadmap_backend.dart';
import 'roadmap_controller.dart';
import 'roadmap_parts.dart';

String _asIso(DateTime day) =>
    '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';

/// Each Milestone belongs to one Goal or is a Standard Milestone, so the Student picks which.
class AddMilestoneScreen extends StatefulWidget {
  const AddMilestoneScreen({super.key, required this.roadmap});

  final RoadmapController roadmap;

  @override
  State<AddMilestoneScreen> createState() => _AddMilestoneScreenState();
}

class _AddMilestoneScreenState extends State<AddMilestoneScreen> {
  final _name = TextEditingController();
  DateTime? _due;

  /// Null means Standard.
  int? _goalId;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _chooseDate() async {
    final today = DateUtils.dateOnly(DateTime.now());
    final chosen = await showDatePicker(
      context: context,
      initialDate: _due ?? today,
      firstDate: today.subtract(const Duration(days: 365)),
      lastDate: today.add(const Duration(days: 365 * 10)),
    );
    if (chosen != null) setState(() => _due = chosen);
  }

  Future<void> _save() async {
    final roadmap = widget.roadmap;
    await roadmap.addMilestone(name: _name.text.trim(), dueDate: _asIso(_due!), goalId: _goalId);
    if (mounted && roadmap.problem == null) Navigator.of(context).pop();
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final goals = widget.roadmap.goals ?? const <Goal>[];
    final due = _due;
    return Scaffold(
      appBar: AppBar(title: const Text('Add a Milestone')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _name,
            minLines: 1,
            maxLines: 4,
            keyboardType: TextInputType.multiline,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'What to do or decide', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 16),
          Semantics(
            container: true,
            child: Text(due == null ? 'No date yet.' : 'Due ${MaterialLocalizations.of(context).formatFullDate(due)}.'),
          ),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton(onPressed: _chooseDate, child: Text(due == null ? 'Choose a date' : 'Change the date')),
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<int?>(
            initialValue: _goalId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'What it belongs to', border: OutlineInputBorder()),
            selectedItemBuilder: (context) => [
              const Text('Standard Milestone, for no one Goal', overflow: TextOverflow.ellipsis),
              for (final goal in goals) Text(goal.text, overflow: TextOverflow.ellipsis),
            ],
            items: [
              const DropdownMenuItem<int?>(value: null, child: Text('Standard Milestone, for no one Goal')),
              for (final goal in goals) DropdownMenuItem<int?>(value: goal.id, child: Text(goal.text)),
            ],
            onChanged: (goalId) => setState(() => _goalId = goalId),
          ),
          const SizedBox(height: 16),
          ValueListenableBuilder(
            valueListenable: _name,
            builder: (context, value, _) => Align(
              alignment: AlignmentDirectional.centerStart,
              child: FilledButton(onPressed: value.text.trim().isEmpty || due == null ? null : _save, child: const Text('Save')),
            ),
          ),
          if (widget.roadmap.problem case final problem?) ProblemNote(problem),
        ],
      ),
    );
  }
}
