import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../chat/crisis_card.dart';
import 'opportunities_controller.dart';
import 'opportunity_card.dart';

const _shownAtATime = 10;

/// Everything with a date that Buddy has found: Temple's first, then what's outside Temple.
class OpportunitiesScreen extends StatefulWidget {
  const OpportunitiesScreen({super.key, required this.opportunities, required this.openPhone});

  final OpportunitiesController opportunities;
  final PhoneOpener openPhone;

  @override
  State<OpportunitiesScreen> createState() => _OpportunitiesScreenState();
}

class _OpportunitiesScreenState extends State<OpportunitiesScreen> {
  int _shown = _shownAtATime;

  Widget _message(BuildContext context, String words, {Widget? action, bool isProblem = false}) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Semantics(container: true, liveRegion: isProblem, child: Text(words, textAlign: TextAlign.center)),
            ?action,
          ],
        ),
      ),
    );
  }

  Widget _heading(BuildContext context, String words) {
    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 2),
      child: Semantics(header: true, child: Text(words, style: Theme.of(context).textTheme.titleLarge)),
    );
  }

  Widget _card(Opportunity opportunity) => OpportunityCard(
        // Keeps each card's state with its own Opportunity as the list changes around it.
        key: ValueKey(opportunity.id),
        opportunity: opportunity,
        opportunities: widget.opportunities,
        openPhone: widget.openPhone,
      );

  Widget _body(BuildContext context) {
    final all = widget.opportunities.all;
    if (widget.opportunities.couldNotLoad) {
      return _message(
        context,
        "Buddy couldn't load these. Check that the backend is running.",
        isProblem: true,
        action: TextButton(onPressed: widget.opportunities.load, child: const Text('Try again')),
      );
    }
    if (all == null) return const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading Opportunities'));
    if (all.isEmpty) {
      return _message(
        context,
        "Nothing to show yet. Buddy reads Temple's events each day, and searches for what fits your Goals when they change and once a week.",
      );
    }

    final shown = all.take(_shown).toList();
    final atTemple = shown.where((opportunity) => !opportunity.outsideTemple).toList();
    final outside = shown.where((opportunity) => opportunity.outsideTemple).toList();
    final more = all.length - shown.length;
    final nextBatch = more < _shownAtATime ? more : _shownAtATime;
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        if (atTemple.isNotEmpty) _heading(context, 'At Temple'),
        ...atTemple.map(_card),
        if (outside.isNotEmpty) ...[
          _heading(context, outsideTempleLabel),
          const Text("These aren't Temple's own, so check each one's Source before you sign up."),
        ],
        ...outside.map(_card),
        if (more > 0)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton(
              onPressed: () => setState(() => _shown += _shownAtATime),
              child: Text(
                'Show $nextBatch more',
                semanticsLabel: 'Show $nextBatch more ${nextBatch == 1 ? 'Opportunity' : 'Opportunities'}',
              ),
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Opportunities')),
      body: SafeArea(
        child: ListenableBuilder(
          listenable: widget.opportunities,
          builder: (context, _) => _body(context),
        ),
      ),
    );
  }
}
