import 'package:flutter/material.dart';

import '../chat/chat_controller.dart';
import '../chat/crisis_card.dart';
import 'roadmap_backend.dart';
import 'roadmap_controller.dart';
import 'source_link.dart';

const _tapDidNotCount = "The app couldn't reach Buddy, so nothing changed. Check that the backend is running, then try again.";

/// Buddy's proposal for a Roadmap, or for a change to one. Nothing happens until the Student taps Accept, one
/// tap that isn't a Permission. Its height is whatever its Milestones need, and the conversation's list scrolls
/// it, so a tall card's top can always be reached.
class RoadmapCardView extends StatefulWidget {
  const RoadmapCardView({
    super.key,
    required this.card,
    required this.chat,
    required this.roadmap,
    required this.openPhone,
    this.announce = false,
  });

  final RoadmapCard card;
  final ChatController chat;
  final RoadmapController roadmap;
  final PhoneOpener openPhone;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  @override
  State<RoadmapCardView> createState() => _RoadmapCardViewState();
}

class _RoadmapCardViewState extends State<RoadmapCardView> {
  String? _problem;

  /// A card decided by a tap just now says so aloud. One that comes back with the conversation doesn't.
  bool _tappedHere = false;

  Future<void> _tap(Future<RoadmapCard?> Function(RoadmapCard card) tap) async {
    setState(() => _problem = null);
    try {
      final card = await tap(widget.card);
      if (card != null) {
        _tappedHere = true;
        widget.chat.showRoadmapCard(card);
      }
    } on Exception {
      if (mounted) setState(() => _problem = _tapDidNotCount);
    }
  }

  Future<void> _open(Uri address) async {
    bool opened;
    try {
      opened = await widget.openPhone(address);
    } on Exception {
      opened = false;
    }
    if (mounted) setState(() => _problem = opened ? null : couldNotOpenLink);
  }

  String get _title => widget.card.isFirst ? 'Your first Roadmap' : 'A change to your Roadmap';

  String? get _outcome => switch (widget.card.status) {
        RoadmapCardStatus.waiting => null,
        RoadmapCardStatus.accepted => "You accepted this. It's on your Roadmap tab, where you can change anything.",
        RoadmapCardStatus.notNow => 'You said not now, so nothing changed.',
        RoadmapCardStatus.replaced => 'Buddy made a newer card, so this one no longer works.',
        RoadmapCardStatus.outOfDate => "This is out of date, because you've removed a Goal it was for.",
      };

  Widget _milestone(BuildContext context, ProposedMilestone milestone) {
    final theme = Theme.of(context);
    final sourceLine = milestone.sources.isEmpty ? milestone.sourceNote : 'From: ${milestone.sources.first.title}';
    final lines = [milestone.badge, milestone.when, ?sourceLine];
    return Semantics(
      container: true,
      label: '${milestone.name}. ${lines.map((line) => line.endsWith('.') ? line : '$line.').join(' ')}',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.only(top: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(milestone.name, style: theme.textTheme.titleSmall),
            Text(milestone.badge, style: theme.textTheme.bodySmall),
            Text(milestone.when),
            if (sourceLine != null) Text(sourceLine, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final card = widget.card;
    final theme = Theme.of(context);
    final outcome = _outcome;
    // One Source can back many Milestones, such as the Bulletin's plan, so each is listed once.
    final sources = {for (final milestone in card.milestones) for (final source in milestone.sources) source.url: source}.values;
    return Card(
      // It holds controls as well as words, so it's a set of separate nodes rather than one.
      semanticContainer: false,
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              container: true,
              liveRegion: widget.announce,
              label: 'Roadmap card: $_title. ${card.why}${card.note == null ? '' : ' ${card.note}'}',
              excludeSemantics: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_title, style: theme.textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(card.why),
                  if (card.note case final note?)
                    Padding(padding: const EdgeInsets.only(top: 4), child: Text(note, style: theme.textTheme.bodySmall)),
                ],
              ),
            ),
            for (final milestone in card.milestones) _milestone(context, milestone),
            for (final removed in card.removes)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Semantics(container: true, child: Text('Takes off: ${removed.name}')),
              ),
            const SizedBox(height: 8),
            for (final source in sources) SourceLink(source: source, open: _open),
            if (outcome != null)
              Semantics(
                container: true,
                liveRegion: _tappedHere,
                child: Padding(padding: const EdgeInsets.only(top: 8), child: Text(outcome, style: theme.textTheme.titleSmall)),
              )
            else
              ListenableBuilder(
                listenable: widget.roadmap,
                builder: (context, _) {
                  final waiting = widget.roadmap.isBeingDecided(card);
                  return Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      FilledButton(onPressed: waiting ? null : () => _tap(widget.roadmap.accept), child: const Text('Accept')),
                      TextButton(onPressed: waiting ? null : () => _tap(widget.roadmap.notNow), child: const Text('Not now')),
                    ],
                  );
                },
              ),
            if (_problem case final problem?) ProblemNote(problem),
          ],
        ),
      ),
    );
  }
}
