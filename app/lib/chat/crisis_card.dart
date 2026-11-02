import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens a tel: or sms: address in the phone's own app. Returns false if it couldn't.
typedef PhoneOpener = Future<bool> Function(Uri address);

Future<bool> openWithPhone(Uri address) => launchUrl(address);

class _Action {
  const _Action(this.label, this.icon, this.address);

  final String label;
  final IconData icon;
  final String address;
}

class _CrisisResource {
  const _CrisisResource(this.name, this.actions);

  final String name;
  final List<_Action> actions;
}

const _title = 'Help is here, right now';
const _intro = 'Tap one to reach a real person.';
const _couldNotOpen =
    "Your phone couldn't open that. Dial the number yourself, or use another phone if you can.";

/// Written here rather than by the model or the backend, so that what the Student sees can't come
/// from anything Claude wrote, and it's there whatever the model does.
const _crisisResources = [
  _CrisisResource('988 Suicide & Crisis Lifeline', [
    _Action('Call 988', Icons.call, 'tel:988'),
    _Action('Text 988', Icons.sms, 'sms:988'),
  ]),
  _CrisisResource('Crisis Text Line', [
    _Action('Text HOME to 741741', Icons.sms, 'sms:741741?body=HOME'),
  ]),
  _CrisisResource('Emergency services', [
    _Action('Call 911', Icons.call, 'tel:911'),
  ]),
  _CrisisResource('Tuttleman Counseling at Temple', [
    _Action('Call (215) 204-7276', Icons.call, 'tel:+12152047276'),
  ]),
];

class CrisisCard extends StatefulWidget {
  const CrisisCard({super.key, required this.announce, required this.openPhone});

  /// True when it has just appeared, so it should be read out and brought into view.
  final bool announce;
  final PhoneOpener openPhone;

  @override
  State<CrisisCard> createState() => _CrisisCardState();
}

class _CrisisCardState extends State<CrisisCard> {
  bool _couldNotOpenLast = false;

  @override
  void initState() {
    super.initState();
    if (widget.announce) {
      // With large text the card can be taller than the screen, and the list is anchored to its
      // bottom. This starts the Student at the top, with the title and 988.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Scrollable.ensureVisible(context, alignment: 1);
      });
    }
  }

  Future<void> _open(_Action action) async {
    bool opened;
    try {
      opened = await widget.openPhone(Uri.parse(action.address));
    } on Exception {
      opened = false;
    }
    if (mounted) setState(() => _couldNotOpenLast = !opened);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surface,
          border: Border.all(color: colors.primary, width: 2),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(
                container: true,
                liveRegion: widget.announce,
                label: 'Crisis help from Buddy. $_title. $_intro',
                excludeSemantics: true,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_title, style: theme.textTheme.titleMedium?.copyWith(color: colors.primary)),
                    const SizedBox(height: 4),
                    const Text(_intro),
                  ],
                ),
              ),
              for (final resource in _crisisResources) ...[
                const SizedBox(height: 12),
                Text(resource.name, style: theme.textTheme.labelLarge),
                for (final action in resource.actions)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: FilledButton.icon(
                      icon: Icon(action.icon),
                      label: Text(action.label),
                      onPressed: () => _open(action),
                    ),
                  ),
              ],
              if (_couldNotOpenLast) ...[
                const SizedBox(height: 12),
                Semantics(
                  liveRegion: true,
                  child: Text(_couldNotOpen, style: TextStyle(color: colors.error)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
