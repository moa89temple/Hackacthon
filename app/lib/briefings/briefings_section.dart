import 'package:flutter/material.dart';

import '../design/parts.dart';
import 'briefing_backend.dart';
import 'briefing_time_dialog.dart';
import 'briefings_controller.dart';
import 'phone_notifications_controller.dart';

/// The Student's control over when Briefings go, and the plain truth about whether they reach the phone.
class NudgesScreen extends StatelessWidget {
  const NudgesScreen({super.key, required this.briefings, required this.phone});

  final BriefingsController briefings;
  final PhoneNotificationsController phone;

  Future<void> _change(
    BuildContext context, {
    required String current,
    required String title,
    required BriefingTimes Function(String chosen) timesWith,
  }) async {
    final chosen = await askForBriefingTime(context, title: title, current: current);
    if (chosen != null) await briefings.saveTimes(timesWith(chosen));
  }

  /// What's true of phone notifications here and now. The backend's side comes first, because nothing the phone does can help without it.
  (String, {bool canAsk}) _phoneWords(BriefingSettings settings) {
    if (!settings.phoneNotificationsOn) {
      return (settings.offBecause ?? "Phone notifications aren't set up yet, so your Briefings only show on the Today tab.", canAsk: false);
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
          "The app couldn't tell the backend where to reach this phone. It tries again each time you come back to Buddy or open this tab.",
          canAsk: false,
        ),
      PhoneNotificationStatus.registered => ('Phone notifications are on. Tap one to see your Briefing on the Today tab.', canAsk: false),
    };
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([briefings, phone]),
      builder: (context, _) {
        final settings = briefings.settings;
        final times = settings?.times;
        return SubScreen(
          title: 'Nudges',
          subtitle: "What Buddy sends without being asked.",
          children: [
            if (briefings.couldNotLoadSettings)
              EmptyState(
                icon: Icons.notifications_none,
                isProblem: true,
                words: "The app can't reach Buddy right now. Check that the backend is running.",
                action: AppLink('Try again', semanticsLabel: 'Try loading your Briefing times again', onPressed: briefings.load),
              )
            else if (settings == null || times == null)
              const LoadingBlock(label: 'Loading your Briefing times')
            else ...[
              ScreenSection(
                title: 'Briefings',
                children: [
                  const Text("A short Briefing each weekday and a week ahead each Sunday, with what's relevant to you right now. Times are Philadelphia time, wherever your phone is."),
                  const SizedBox(height: 12),
                  RowGroup(
                    children: [
                      NavRow(
                        title: 'Weekdays at ${_inWords(context, times.weekdays)}',
                        semanticsLabel: 'Weekday Briefings go at ${_inWords(context, times.weekdays)}. Change the time',
                        onTap: () {
                          if (briefings.isChanging) return;
                          _change(
                            context,
                            current: times.weekdays,
                            title: 'Weekday Briefing time',
                            timesWith: (chosen) => BriefingTimes(weekdays: chosen, sunday: times.sunday),
                          );
                        },
                      ),
                      NavRow(
                        title: 'Sundays at ${_inWords(context, times.sunday)}',
                        semanticsLabel: 'Sunday week-ahead Briefings go at ${_inWords(context, times.sunday)}. Change the time',
                        onTap: () {
                          if (briefings.isChanging) return;
                          _change(
                            context,
                            current: times.sunday,
                            title: 'Sunday week-ahead Briefing time',
                            timesWith: (chosen) => BriefingTimes(weekdays: times.weekdays, sunday: chosen),
                          );
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Semantics(container: true, liveRegion: true, child: Text('Your next Briefing is ${settings.nextWhen}.')),
                  if (briefings.problem case final problem?) ProblemNote(problem),
                ],
              ),
              ScreenSection(title: 'Phone notifications', children: _phonePart(settings)),
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
