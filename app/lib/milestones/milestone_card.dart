import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../chat/crisis_card.dart';

const _couldNotOpen = "Your phone couldn't open that.";
const _mostSourcesShown = 3;

/// A Standard Milestone with its date and Source, on the Today tab and in the conversation.
/// Everything on it comes from the backend's own record of the page, never from what Claude wrote.
class MilestoneCard extends StatefulWidget {
  const MilestoneCard({super.key, required this.milestone, required this.openPhone, this.announce = false});

  final StandardMilestone milestone;
  final PhoneOpener openPhone;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  @override
  State<MilestoneCard> createState() => _MilestoneCardState();
}

class _MilestoneCardState extends State<MilestoneCard> {
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
    final milestone = widget.milestone;
    final theme = Theme.of(context);
    final moreSources = milestone.sources.length - _mostSourcesShown;
    final lines = [
      milestone.when,
      ?milestone.term,
      if (milestone.passed) 'This date has passed.',
    ];
    return Card(
      // It holds a control as well as words, so it's a set of separate nodes rather than one.
      semanticContainer: false,
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // One item, because on Android its lines otherwise run together with the button's.
            Semantics(
              container: true,
              liveRegion: widget.announce,
              label: 'Standard Milestone: ${milestone.name}. ${lines.map((line) => line.endsWith('.') ? line : '$line.').join(' ')}',
              excludeSemantics: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(milestone.name, style: theme.textTheme.titleMedium),
                  for (final line in lines) Padding(padding: const EdgeInsets.only(top: 4), child: Text(line)),
                ],
              ),
            ),
            const SizedBox(height: 4),
            for (final source in milestone.sources.take(_mostSourcesShown)) _source(context, source),
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
          ],
        ),
      ),
    );
  }
}

/// In place of a card whose date isn't on its page any more.
class GoneMilestoneNote extends StatelessWidget {
  const GoneMilestoneNote({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(
          "Buddy no longer shows this date, because it's gone from its Source.",
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ),
    );
  }
}
