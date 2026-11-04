import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../chat/crisis_card.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import 'opportunities_controller.dart';

const outsideTempleLabel = 'Outside Temple';
const _couldNotOpen = "Your phone couldn't open that.";
const _couldNotSave = "Buddy couldn't change that. Check that the backend is running, then try again.";
const _couldNotReport = "Buddy couldn't send your Report. Check that the backend is running, then try again.";

/// An Opportunity with its date, its cost and its Source, wherever it shows. Everything on it comes from the
/// backend's own record of the page, never from what Claude wrote.
class OpportunityCard extends StatefulWidget {
  const OpportunityCard({
    super.key,
    required this.opportunity,
    required this.opportunities,
    required this.openPhone,
    this.announce = false,
    this.inGroup = false,
  });

  final Opportunity opportunity;
  final OpportunitiesController opportunities;
  final PhoneOpener openPhone;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  /// A row in a group, which has its own outline.
  final bool inGroup;

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
          TextButton(
            style: TextButton.styleFrom(foregroundColor: BuddyColors.problem),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Report'),
          ),
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

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(listenable: widget.opportunities, builder: (context, _) => _card(context));
  }

  Widget _card(BuildContext context) {
    final opportunity = widget.opportunity;
    if (widget.opportunities.wasReported(opportunity)) {
      return widget.inGroup
          ? const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: GoneOpportunityNote(reportedJustNow: true))
          : const GoneOpportunityNote(reportedJustNow: true);
    }

    final theme = Theme.of(context);
    final saved = widget.opportunities.isSaved(opportunity);
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
    final content = Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ExcludeSemantics(child: Icon(Icons.work_outline, size: 24, color: BuddyColors.ink)),
          const SizedBox(width: 16),
          Expanded(
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
                          child: Pill(outsideTempleLabel, tone: PillTone.warning),
                        )
                      else
                        Padding(
                          padding: const EdgeInsets.only(bottom: 2),
                          child: Text('OPPORTUNITY', style: theme.textTheme.labelMedium),
                        ),
                      Text(opportunity.name, style: theme.textTheme.titleMedium),
                      for (final line in lines) Padding(padding: const EdgeInsets.only(top: 2), child: Text(line)),
                    ],
                  ),
                ),
                const SizedBox(height: 2),
                SourceLinks(sources: opportunity.sources, open: _open),
                if (_problem case final problem?) ProblemNote(problem),
                // Wraps, so that large text puts these on separate lines rather than off the card.
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  children: [
                    TextButton.icon(
                      style: TextButton.styleFrom(foregroundColor: BuddyColors.cherry, padding: EdgeInsets.zero),
                      onPressed: () => _setSaved(!saved),
                      icon: Icon(saved ? Icons.bookmark : Icons.bookmark_border),
                      label: Text(
                        saved ? 'Saved. Tap to remove' : 'Save',
                        semanticsLabel: saved ? 'Remove ${opportunity.name} from what you saved' : 'Save ${opportunity.name}',
                      ),
                    ),
                    TextButton(
                      style: TextButton.styleFrom(foregroundColor: BuddyColors.inkSoft),
                      onPressed: _report,
                      child: Text('Report', semanticsLabel: 'Report ${opportunity.name} as wrong or out of date'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
    if (widget.inGroup) return content;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      // It holds several controls, so it's a set of separate nodes rather than one.
      child: Card(semanticContainer: false, child: content),
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
