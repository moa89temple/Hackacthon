import 'package:flutter/material.dart';

import '../chat/crisis_card.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import 'roadmap_backend.dart';
import 'roadmap_controller.dart';
import 'roadmap_parts.dart';

const _calendarHost = 'calendar.google.com';

/// One Milestone: everything known about it, where that came from, and what can be done with it.
class MilestoneScreen extends StatefulWidget {
  const MilestoneScreen({super.key, required this.milestoneId, required this.roadmap, required this.openPhone});

  final int milestoneId;
  final RoadmapController roadmap;
  final PhoneOpener openPhone;

  @override
  State<MilestoneScreen> createState() => _MilestoneScreenState();
}

class _MilestoneScreenState extends State<MilestoneScreen> {
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

  Uri? _calendarAddress(RoadmapMilestone milestone) {
    final address = Uri.tryParse(milestone.calendarUrl);
    return address?.scheme == 'https' && address?.host == _calendarHost ? address : null;
  }

  Future<void> _remove(RoadmapMilestone milestone) async {
    final navigator = Navigator.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: const Text('Remove this Milestone?'),
        content: Text(milestone.name),
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
    if (confirmed != true) return;
    await widget.roadmap.remove(milestone);
    if (widget.roadmap.problem == null) navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.roadmap,
      builder: (context, _) {
        final roadmap = widget.roadmap;
        final milestone = roadmap.milestones?.where((other) => other.id == widget.milestoneId).firstOrNull;
        if (milestone == null) return const SubScreen(children: []);
        final text = Theme.of(context).textTheme;
        final calendar = _calendarAddress(milestone);
        final busy = roadmap.isChanging;
        final problem = roadmap.problem ?? _phoneProblem;
        return SubScreen(
          title: milestone.name,
          children: [
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Pill(milestone.goal?.text ?? 'Standard Milestone', tone: milestone.goal == null ? PillTone.quiet : PillTone.cherry),
            ),
            const SizedBox(height: 12),
            Semantics(container: true, child: Text(milestone.when, style: text.titleMedium)),
            if (milestone.done)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text('Done'),
              ),
            if (milestone.goneFromSource)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text("Buddy no longer finds this date, because it's gone from its Source. This is what it last said.", style: text.bodySmall),
              ),
            if (milestone.detail case final detail?) Padding(padding: const EdgeInsets.only(top: 12), child: Text(detail)),
            if (milestone.sources.isEmpty)
              if (milestone.sourceNote case final note?) Padding(padding: const EdgeInsets.only(top: 12), child: Text(note, style: text.bodySmall)),
            if (milestone.sources.isNotEmpty) const SizedBox(height: 8),
            for (final source in milestone.sources) SourceLink(source: source, open: _open),
            if (problem != null) ProblemNote(problem),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: busy ? null : () => roadmap.setDone(milestone, done: !milestone.done),
              icon: Icon(milestone.done ? Icons.undo : Icons.check),
              label: Text(milestone.done ? 'Mark as not done' : 'Mark as done', semanticsLabel: '${milestone.done ? 'Mark as not done' : 'Mark as done'}: ${milestone.name}'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: calendar == null ? null : () => _open(calendar),
              icon: const Icon(Icons.calendar_month_outlined),
              label: Text('Add to Google Calendar', semanticsLabel: 'Add to Google Calendar: ${milestone.name}'),
            ),
            const SizedBox(height: 24),
            Align(
              child: TextButton(
                style: TextButton.styleFrom(foregroundColor: BuddyColors.problem),
                onPressed: busy ? null : () => _remove(milestone),
                child: Text('Remove from your Roadmap', semanticsLabel: 'Remove: ${milestone.name}'),
              ),
            ),
          ],
        );
      },
    );
  }
}
