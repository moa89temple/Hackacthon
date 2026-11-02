import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';

const couldNotOpen = "Your phone couldn't open that.";
const nothingChanged = "The app couldn't reach Buddy, so nothing changed. Check that the backend is running, then try again.";

/// A Milestone's Source, which the Student can tap to read the page itself.
class SourceButton extends StatelessWidget {
  const SourceButton({super.key, required this.source, required this.open});

  final GuidebookSource source;
  final void Function(Uri address) open;

  @override
  Widget build(BuildContext context) {
    final address = Uri.tryParse(source.url);
    final lastSeen = MaterialLocalizations.of(context).formatFullDate(source.lastSeenAt.toLocal());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextButton(
          style: TextButton.styleFrom(alignment: AlignmentDirectional.centerStart),
          onPressed: address?.scheme == 'https' ? () => open(address!) : null,
          child: Text('Source: ${source.title}', semanticsLabel: 'Open Source: ${source.title}, last seen $lastSeen'),
        ),
        ExcludeSemantics(child: Text('Last seen $lastSeen', style: Theme.of(context).textTheme.bodySmall)),
      ],
    );
  }
}

/// Says something went wrong, where a screen reader will read it out.
class ProblemNote extends StatelessWidget {
  const ProblemNote(this.words, {super.key});

  final String words;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Text(words, style: TextStyle(color: Theme.of(context).colorScheme.error)),
      ),
    );
  }
}
