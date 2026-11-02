import 'package:flutter/material.dart';

import '../chat/crisis_card.dart';
import '../connections/connections_controller.dart';
import '../connections/login_request.dart';
import '../milestones/milestone_card.dart';
import '../milestones/milestones_controller.dart';

const _shownAtATime = 10;

/// The Standard Milestones coming up, soonest first, each from its Source.
class TodayTab extends StatefulWidget {
  const TodayTab({super.key, required this.milestones, required this.connections, required this.openPhone});

  final MilestonesController milestones;

  /// Buddy asks here for any login it needs, because this is the tab the Student looks at each day.
  final ConnectionsController connections;
  final PhoneOpener openPhone;

  @override
  State<TodayTab> createState() => _TodayTabState();
}

class _TodayTabState extends State<TodayTab> {
  int _shown = _shownAtATime;

  Widget _message(BuildContext context, String words, {Widget? action, bool isProblem = false}) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ExcludeSemantics(child: Icon(Icons.today, size: 48, color: Theme.of(context).colorScheme.primary)),
            const SizedBox(height: 16),
            Semantics(container: true, liveRegion: isProblem, child: Text(words, textAlign: TextAlign.center)),
            ?action,
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        LoginRequests(connections: widget.connections),
        Expanded(child: _comingUp(context)),
      ],
    );
  }

  Widget _comingUp(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.milestones,
      builder: (context, _) {
        final upcoming = widget.milestones.upcoming;
        if (widget.milestones.couldNotLoad) {
          return _message(
            context,
            "Buddy couldn't load what's coming up. Check that the backend is running.",
            isProblem: true,
            action: TextButton(onPressed: widget.milestones.load, child: const Text('Try again')),
          );
        }
        if (upcoming == null) return const Center(child: CircularProgressIndicator());
        if (upcoming.isEmpty) {
          return _message(
            context,
            "No dates to show yet. Buddy reads Temple's calendar and deadline pages each day, and what's coming up will show here.",
          );
        }

        final shown = upcoming.take(_shown).toList();
        final more = upcoming.length - shown.length;
        final nextBatch = more < _shownAtATime ? more : _shownAtATime;
        return ListView(
          padding: const EdgeInsets.all(12),
          children: [
            Semantics(
              header: true,
              child: Text('Coming up', style: Theme.of(context).textTheme.titleLarge),
            ),
            const SizedBox(height: 4),
            const Text("Dates every Temple Student faces, from the registrar and Student Financial Services."),
            const SizedBox(height: 6),
            for (final milestone in shown)
              // Keeps each card's state with its own date as the list changes around it.
              MilestoneCard(key: ValueKey(milestone.id), milestone: milestone, openPhone: widget.openPhone),
            if (more > 0)
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton(
                  onPressed: () => setState(() => _shown += _shownAtATime),
                  child: Text(
                    'Show $nextBatch more',
                    semanticsLabel: 'Show $nextBatch more ${nextBatch == 1 ? 'date' : 'dates'}',
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
