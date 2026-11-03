import 'package:flutter/material.dart';

import '../chat/crisis_card.dart';
import '../connections/connections_controller.dart';
import '../connections/login_request.dart';
import '../milestones/milestone_card.dart';
import '../milestones/milestones_controller.dart';
import '../opportunities/opportunities_controller.dart';
import '../opportunities/opportunities_screen.dart';
import '../opportunities/opportunity_card.dart';

const _shownAtATime = 10;

/// What the Student saved, then the Standard Milestones coming up, soonest first, each from its Source.
class TodayTab extends StatefulWidget {
  const TodayTab({super.key, required this.milestones, required this.opportunities, required this.connections, required this.openPhone});

  final MilestonesController milestones;
  final OpportunitiesController opportunities;

  /// Buddy asks here for any login it needs, because this is the tab the Student looks at each day.
  final ConnectionsController connections;
  final PhoneOpener openPhone;

  @override
  State<TodayTab> createState() => _TodayTabState();
}

class _TodayTabState extends State<TodayTab> {
  int _shown = _shownAtATime;

  Widget _message(BuildContext context, String words, {Widget? action, bool isProblem = false}) {
    return Padding(
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
    );
  }

  void _openOpportunities() {
    widget.opportunities.load();
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => OpportunitiesScreen(opportunities: widget.opportunities, openPhone: widget.openPhone),
      ),
    );
  }

  /// There whatever has become of the dates, because what the Student saved doesn't depend on them.
  List<Widget> _opportunitiesPart(BuildContext context) {
    final saved = widget.opportunities.saved;
    return [
      if (saved.isNotEmpty) ...[
        Semantics(
          header: true,
          child: Text('Saved Opportunities', style: Theme.of(context).textTheme.titleLarge),
        ),
        const SizedBox(height: 6),
        for (final opportunity in saved)
          OpportunityCard(
            // Keeps each card's state with its own Opportunity as the list changes around it.
            key: ValueKey('opportunity ${opportunity.id}'),
            opportunity: opportunity,
            opportunities: widget.opportunities,
            openPhone: widget.openPhone,
          ),
      ],
      Align(
        alignment: AlignmentDirectional.centerStart,
        child: TextButton(onPressed: _openOpportunities, child: const Text('See Opportunities')),
      ),
    ];
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
      listenable: Listenable.merge([widget.milestones, widget.opportunities]),
      builder: (context, _) {
        final upcoming = widget.milestones.upcoming;
        final opportunitiesPart = _opportunitiesPart(context);
        Widget withOpportunities(Widget below) => ListView(padding: const EdgeInsets.all(12), children: [...opportunitiesPart, below]);
        if (widget.milestones.couldNotLoad) {
          return withOpportunities(_message(
            context,
            "Buddy couldn't load what's coming up. Check that the backend is running.",
            isProblem: true,
            action: TextButton(onPressed: widget.milestones.load, child: const Text('Try again')),
          ));
        }
        if (upcoming == null) return withOpportunities(const Center(child: CircularProgressIndicator()));
        if (upcoming.isEmpty) {
          return withOpportunities(_message(
            context,
            "No dates to show yet. Buddy reads Temple's calendar and deadline pages each day, and what's coming up will show here.",
          ));
        }

        final shown = upcoming.take(_shown).toList();
        final more = upcoming.length - shown.length;
        final nextBatch = more < _shownAtATime ? more : _shownAtATime;
        return ListView(
          padding: const EdgeInsets.all(12),
          children: [
            ...opportunitiesPart,
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
