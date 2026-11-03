import 'package:flutter/material.dart';

import 'briefing_backend.dart';
import 'briefing_time_dialog.dart';
import 'briefings_controller.dart';
import 'phone_notifications_controller.dart';

/// The You tab's control over when Briefings go, and the plain truth about whether they reach the phone.
class BriefingsSection extends StatelessWidget {
  const BriefingsSection({super.key, required this.briefings, required this.phone});

  final BriefingsController briefings;
  final PhoneNotificationsController phone;

  Future<void> _change(
    BuildContext context, {
    required String current,
    required String helpText,
    required BriefingTimes Function(String chosen) timesWith,
  }) async {
    final chosen = await askForBriefingTime(context, title: helpText, current: current);
    if (chosen != null) await briefings.saveTimes(timesWith(chosen));
  }

  /// What's true of phone notifications here and now. The backend's side comes first, because nothing the phone does can help without it.
  (String, {bool canAsk}) _phoneWords(BriefingSettings settings) {
    if (!settings.phoneNotificationsOn) {
      return (settings.offBecause ?? 'Phone notifications are off on the backend. Briefings still show on the Today tab.', canAsk: false);
    }
    return switch (phone.status) {
      PhoneNotificationStatus.checking => ('Checking phone notifications.', canAsk: false),
      PhoneNotificationStatus.notInThisBuild => (
          "Phone notifications aren't set up in this build of the app, because it has no Firebase config. Briefings still show on the Today tab.",
          canAsk: false,
        ),
      PhoneNotificationStatus.notAllowed => (
          "You haven't allowed notifications for Buddy on this phone, so Briefings only show on the Today tab. If nothing happens when you tap the button, allow them in your phone's settings.",
          canAsk: true,
        ),
      PhoneNotificationStatus.noToken => (
          "Firebase didn't give this phone a way to be reached, so Briefings only show on the Today tab. An emulator needs Google Play for this.",
          canAsk: false,
        ),
      PhoneNotificationStatus.notRegistered => (
          "The app couldn't tell the backend where to reach this phone. It tries again each time you open this tab.",
          canAsk: false,
        ),
      PhoneNotificationStatus.registered => ('Phone notifications are on. Tap one to see your Briefing on the Today tab.', canAsk: false),
    };
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: Listenable.merge([briefings, phone]),
      builder: (context, _) {
        final settings = briefings.settings;
        final times = settings?.times;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(header: true, child: Text('Briefings', style: theme.textTheme.titleMedium)),
            const SizedBox(height: 8),
            if (briefings.couldNotLoadSettings) ...[
              Semantics(liveRegion: true, child: const Text("The app can't reach Buddy right now. Check that the backend is running.")),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton(onPressed: briefings.load, child: const Text('Try again', semanticsLabel: 'Try loading your Briefing times again')),
              ),
            ] else if (settings == null || times == null)
              const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading your Briefing times'))
            else ...[
              const Text("A short Briefing each weekday and a week ahead each Sunday, with what's relevant to you right now. Times are Philadelphia time, wherever your phone is."),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: briefings.isChanging
                    ? null
                    : () => _change(
                          context,
                          current: times.weekdays,
                          helpText: 'Weekday Briefing time',
                          timesWith: (chosen) => BriefingTimes(weekdays: chosen, sunday: times.sunday),
                        ),
                child: Text(
                  'Weekdays at ${_inWords(context, times.weekdays)}',
                  semanticsLabel: 'Weekday Briefings go at ${_inWords(context, times.weekdays)}. Change the time',
                ),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: briefings.isChanging
                    ? null
                    : () => _change(
                          context,
                          current: times.sunday,
                          helpText: 'Sunday week-ahead Briefing time',
                          timesWith: (chosen) => BriefingTimes(weekdays: times.weekdays, sunday: chosen),
                        ),
                child: Text(
                  'Sundays at ${_inWords(context, times.sunday)}',
                  semanticsLabel: 'Sunday week-ahead Briefings go at ${_inWords(context, times.sunday)}. Change the time',
                ),
              ),
              const SizedBox(height: 8),
              Semantics(container: true, liveRegion: true, child: Text('Your next Briefing is ${settings.nextWhen}.')),
              if (briefings.problem case final problem?)
                Semantics(
                  container: true,
                  liveRegion: true,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(problem, style: TextStyle(color: theme.colorScheme.error)),
                  ),
                ),
              const SizedBox(height: 12),
              ..._phonePart(settings),
            ],
          ],
        );
      },
    );
  }

  List<Widget> _phonePart(BriefingSettings settings) {
    final (words, :canAsk) = _phoneWords(settings);
    return [
      Semantics(container: true, liveRegion: true, child: Text(words)),
      if (canAsk) ...[
        const SizedBox(height: 8),
        OutlinedButton(onPressed: phone.askAgain, child: const Text('Allow notifications')),
      ],
    ];
  }
}

TimeOfDay _timeOfDay(String time) {
  final [hour, minute] = time.split(':');
  return TimeOfDay(hour: int.parse(hour), minute: int.parse(minute));
}

String _inWords(BuildContext context, String time) => _timeOfDay(time).format(context);
