import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../chat/crisis_card.dart';
import 'opportunities_controller.dart';

const outsideTempleLabel = 'Outside Temple';
const _couldNotOpen = "Your phone couldn't open that.";
const _couldNotSave = "Buddy couldn't change that. Check that the backend is running, then try again.";
const _couldNotReport = "Buddy couldn't send your Report. Check that the backend is running, then try again.";
const _mostSourcesShown = 3;

/// An Opportunity with its date, its cost and its Source, wherever it shows. Everything on it comes from the
/// backend's own record of the page, never from what Claude wrote.
class OpportunityCard extends StatefulWidget {
  const OpportunityCard({
    super.key,
    required this.opportunity,
    required this.opportunities,
    required this.openPhone,
    this.announce = false,
  });

  final Opportunity opportunity;
  final OpportunitiesController opportunities;
  final PhoneOpener openPhone;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  @override
  State<OpportunityCard> createState() => _OpportunityCardState();
}

class _OpportunityCardState extends State<OpportunityCard> {
  String? _problem;

  Future<void> _open(Uri address) async {
    bool opened;
    try {
      opened = await widget.openPhone(address);
    } on Exception {
      opened = false;
    }
    if (mounted) setState(() => _problem = opened ? null : _couldNotOpen);
  }

  Future<void> _setSaved(bool saved) async {
    setState(() => _problem = null);
    try {
      await widget.opportunities.setSaved(widget.opportunity, saved);
    } on Exception {
      if (mounted) setState(() => _problem = _couldNotSave);
    }
  }

  Future<void> _report() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: Text('Report ${widget.opportunity.name}?'),
        content: const Text(
          "Report it if it's wrong or out of date. Buddy will stop showing it to every Student, and this can't be undone.",
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Report')),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.opportunities.report(widget.opportunity);
    } on Exception {
      if (mounted) setState(() => _problem = _couldNotReport);
    }
  }

  Widget _source(BuildContext context, GuidebookSource source) {
    final address = Uri.tryParse(source.url);
    final lastSeen = MaterialLocalizations.of(context).formatFullDate(source.lastSeenAt.toLocal());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextButton(
          style: TextButton.styleFrom(alignment: AlignmentDirectional.centerStart),
          onPressed: address?.scheme == 'https' ? () => _open(address!) : null,
          child: Text('Source: ${source.title}', semanticsLabel: 'Open Source: ${source.title}, last seen $lastSeen'),
        ),
        ExcludeSemantics(child: Text('Last seen $lastSeen', style: Theme.of(context).textTheme.bodySmall)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(listenable: widget.opportunities, builder: (context, _) => _card(context));
  }

  Widget _card(BuildContext context) {
    final opportunity = widget.opportunity;
    if (widget.opportunities.wasReported(opportunity)) return const GoneOpportunityNote(reportedJustNow: true);

    final theme = Theme.of(context);
    final saved = widget.opportunities.isSaved(opportunity);
    final moreSources = opportunity.sources.length - _mostSourcesShown;
    final lines = [
      opportunity.summary,
      opportunity.when,
      opportunity.cost,
      if (opportunity.worthItBecause case final reason?) 'Why it may be worth it: $reason',
      if (opportunity.place case final place?) 'Where: $place',
      for (final goal in opportunity.forGoals) 'For your Goal: $goal',
    ];
    final spoken = [
      if (opportunity.outsideTemple) outsideTempleLabel,
      ...lines,
      if (saved) 'Saved',
    ].map((line) => line.endsWith('.') ? line : '$line.').join(' ');
    return Card(
      // It holds several controls, so it's a set of separate nodes rather than one.
      semanticContainer: false,
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // One item, because on Android its lines otherwise run together with the buttons'.
            Semantics(
              container: true,
              liveRegion: widget.announce,
              label: 'Opportunity: ${opportunity.name}. $spoken',
              excludeSemantics: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (opportunity.outsideTemple)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(outsideTempleLabel, style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary)),
                    ),
                  Text(opportunity.name, style: theme.textTheme.titleMedium),
                  for (final line in lines) Padding(padding: const EdgeInsets.only(top: 4), child: Text(line)),
                ],
              ),
            ),
            const SizedBox(height: 4),
            TextButton.icon(
              style: TextButton.styleFrom(alignment: AlignmentDirectional.centerStart),
              onPressed: () => _setSaved(!saved),
              icon: Icon(saved ? Icons.bookmark : Icons.bookmark_border),
              label: Text(
                saved ? 'Saved. Tap to remove' : 'Save',
                semanticsLabel: saved ? 'Remove ${opportunity.name} from what you saved' : 'Save ${opportunity.name}',
              ),
            ),
            for (final source in opportunity.sources.take(_mostSourcesShown)) _source(context, source),
            if (moreSources > 0)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('Also on $moreSources more of its pages.', style: theme.textTheme.bodySmall),
              ),
            if (_problem case final problem?)
              Semantics(
                container: true,
                liveRegion: true,
                child: Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(problem, style: TextStyle(color: theme.colorScheme.error)),
                ),
              ),
            TextButton(
              style: TextButton.styleFrom(alignment: AlignmentDirectional.centerStart),
              onPressed: _report,
              child: Text('Report', semanticsLabel: 'Report ${opportunity.name} as wrong or out of date'),
            ),
          ],
        ),
      ),
    );
  }
}

/// In place of a card whose Opportunity Buddy no longer shows.
class GoneOpportunityNote extends StatelessWidget {
  const GoneOpportunityNote({super.key, this.reportedJustNow = false});

  final bool reportedJustNow;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      liveRegion: reportedJustNow,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(
          reportedJustNow
              ? 'You reported this, so Buddy no longer shows it to any Student.'
              : "Buddy no longer shows this, because its date has passed, it was reported or it's gone from its Source.",
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ),
    );
  }
}
