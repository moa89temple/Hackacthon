import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../backend/buddy_backend.dart';
import 'chat_controller.dart';
import 'crisis_email_offer.dart';

/// Opens a tel:, sms:, mailto: or https: address in the phone's own app. Returns false if it couldn't.
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
  const CrisisCard({super.key, required this.item, required this.chat, required this.announce, required this.openPhone});

  final CrisisCardItem item;
  final ChatController chat;

  /// True when it has just appeared, so it should be read out and brought into view.
  final bool announce;
  final PhoneOpener openPhone;

  @override
  State<CrisisCard> createState() => _CrisisCardState();
}

class _CrisisCardState extends State<CrisisCard> {
  bool _couldNotOpenLast = false;

  /// True while this card's turn is still arriving and the Student hasn't scrolled themselves.
  bool _keepingInView = false;
  ScrollPosition? _position;

  @override
  void initState() {
    super.initState();
    if (widget.announce) {
      // With large text the card can be taller than the screen, and the list is anchored to its
      // bottom. This starts the Student at the top, with the title and 988.
      _bringTopIntoView();
      // The reply goes below the card and the list is anchored to its bottom, so the reply would push
      // the title and 988 off the top. They matter more, so the reply goes below the fold if it must.
      _keepingInView = true;
      widget.chat.addListener(_keepTopInView);
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final position = Scrollable.maybeOf(context)?.position;
    if (identical(position, _position)) return;
    _position?.isScrollingNotifier.removeListener(_stopIfStudentScrolled);
    _position = position;
    if (_keepingInView) position?.isScrollingNotifier.addListener(_stopIfStudentScrolled);
  }

  @override
  void dispose() {
    _stopKeepingInView();
    super.dispose();
  }

  void _bringTopIntoView() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Scrollable.ensureVisible(context, alignment: 1);
    });
  }

  void _keepTopInView() {
    _bringTopIntoView();
    if (widget.chat.replyInProgress == null) _stopKeepingInView();
  }

  void _stopIfStudentScrolled() {
    if (_position?.isScrollingNotifier.value == true) _stopKeepingInView();
  }

  void _stopKeepingInView() {
    if (!_keepingInView) return;
    _keepingInView = false;
    widget.chat.removeListener(_keepTopInView);
    _position?.isScrollingNotifier.removeListener(_stopIfStudentScrolled);
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
              // Last, and on its own, so that none of it can come before or hold up the Resources above.
              CrisisEmailOfferView(
                words: widget.item.emailWords,
                chat: widget.chat,
                openPhone: widget.openPhone,
                announce: widget.announce,
                onOpened: _stopKeepingInView,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
