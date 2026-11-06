import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/design/parts.dart';
import 'package:buddy/design/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The contrast between two colors, as WCAG works it out.
double contrast(Color a, Color b) {
  final (lighter, darker) = a.computeLuminance() > b.computeLuminance() ? (a, b) : (b, a);
  return (lighter.computeLuminance() + 0.05) / (darker.computeLuminance() + 0.05);
}

void main() {
  group('the colors', () {
    const pairsThatCarryText = {
      'cherry on white': (BuddyColors.cherry, BuddyColors.surface),
      'white on cherry': (Colors.white, BuddyColors.cherry),
      'cherry on its tint': (BuddyColors.cherry, BuddyColors.cherryTint),
      'ink on white': (BuddyColors.ink, BuddyColors.surface),
      'soft ink on white': (BuddyColors.inkSoft, BuddyColors.surface),
      'a link on white': (BuddyColors.link, BuddyColors.surface),
      'a problem on white': (BuddyColors.problem, BuddyColors.surface),
      'a problem on its tint': (BuddyColors.problem, BuddyColors.problemTint),
      'ink on a warning': (BuddyColors.ink, BuddyColors.warningTint),
      'warning ink on a warning': (BuddyColors.warningInk, BuddyColors.warningTint),
      'good on white': (BuddyColors.good, BuddyColors.surface),
      'good on its tint': (BuddyColors.good, BuddyColors.goodTint),
      'soft ink on a disabled button': (BuddyColors.inkSoft, BuddyColors.hairline),
      // Behind everything.
      'ink on the canvas': (BuddyColors.ink, BuddyColors.canvas),
      'soft ink on the canvas': (BuddyColors.inkSoft, BuddyColors.canvas),
      'cherry on the canvas': (BuddyColors.cherry, BuddyColors.canvas),
      'a link on the canvas': (BuddyColors.link, BuddyColors.canvas),
      'a problem on the canvas': (BuddyColors.problem, BuddyColors.canvas),
      // A card, a group of rows, or Buddy's words.
      'ink on a frame': (BuddyColors.ink, BuddyColors.frame),
      'soft ink on a frame': (BuddyColors.inkSoft, BuddyColors.frame),
      'cherry on a frame': (BuddyColors.cherry, BuddyColors.frame),
      'a link on a frame': (BuddyColors.link, BuddyColors.frame),
      'a problem on a frame': (BuddyColors.problem, BuddyColors.frame),
      'warning ink on a frame': (BuddyColors.warningInk, BuddyColors.frame),
      'good on a frame': (BuddyColors.good, BuddyColors.frame),
      // A gray pill: a quiet button, a status, a day in the conversation.
      'ink on a quiet pill': (BuddyColors.ink, BuddyColors.quiet),
      'soft ink on a quiet pill': (BuddyColors.inkSoft, BuddyColors.quiet),
      'a problem on a quiet pill': (BuddyColors.problem, BuddyColors.quiet),
      // A tooltip, such as a tab's name, and a message at the foot of the screen.
      'white on ink': (Colors.white, BuddyColors.ink),
      // The Student's words, the top of Today and the Crisis card.
      "ink on the Student's bubble": (BuddyColors.ink, BuddyColors.cherryBubble),
      'ink on the cherry tint': (BuddyColors.ink, BuddyColors.cherryTint),
      'soft ink on the cherry tint': (BuddyColors.inkSoft, BuddyColors.cherryTint),
      'a problem on the cherry tint': (BuddyColors.problem, BuddyColors.cherryTint),
    };

    for (final MapEntry(key: name, value: (foreground, background)) in pairsThatCarryText.entries) {
      test('$name is at least the 4.5 to 1 that WCAG AA asks of text', () {
        expect(contrast(foreground, background), greaterThanOrEqualTo(4.5));
      });
    }

    test('keep Temple cherry as the accent', () {
      expect(BuddyColors.cherry, const Color(0xFF9D2235));
      expect(buddyTheme().colorScheme.primary, BuddyColors.cherry);
    });
  });

  group('a Source', () {
    Future<void> show(WidgetTester tester, String title) => tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SourceLink(source: GuidebookSource(url: 'https://www.temple.edu/x', title: title, lastSeenAt: DateTime(2026, 11, 3)), open: (_) {}),
            ),
          ),
        );

    testWidgets("leaves off its site's name, which only makes the link longer", (tester) async {
      await show(tester, 'Financial Aid Deadlines | Student Financial Services');

      expect(find.text('Source: Financial Aid Deadlines'), findsOneWidget);
    });

    testWidgets('keeps the whole title when what is left would say too little', (tester) async {
      await show(tester, 'Home | Student Financial Services');

      expect(find.text('Source: Home | Student Financial Services'), findsOneWidget);
    });

    testWidgets('still reads out the whole title', (tester) async {
      final handle = tester.ensureSemantics();
      await show(tester, 'Financial Aid Deadlines | Student Financial Services');

      expect(find.bySemanticsLabel(RegExp(r'^Open Source: Financial Aid Deadlines \| Student Financial Services, last seen')), findsOneWidget);
      handle.dispose();
    });
  });

  group('every button', () {
    test('is at least as tall as a finger needs, whatever kind it is', () {
      final theme = buddyTheme();
      final heights = [
        theme.filledButtonTheme.style!.minimumSize!.resolve({})!.height,
        theme.outlinedButtonTheme.style!.minimumSize!.resolve({})!.height,
        theme.textButtonTheme.style!.minimumSize!.resolve({})!.height,
      ];
      expect(heights, everyElement(greaterThanOrEqualTo(BuddySizes.tapTarget)));
    });

    test('is a pill, round at each end at its usual height', () {
      final theme = buddyTheme();
      final shapes = [
        theme.filledButtonTheme.style!.shape!.resolve({}),
        theme.outlinedButtonTheme.style!.shape!.resolve({}),
        theme.textButtonTheme.style!.shape!.resolve({}),
      ];
      for (final shape in shapes) {
        expect((shape! as RoundedRectangleBorder).borderRadius, BorderRadius.circular(BuddySizes.tapTarget / 2));
      }
    });

    test('that is quiet stays gray on the canvas and turns white inside a frame, so it shows on both', () {
      final theme = buddyTheme();
      expect(theme.outlinedButtonTheme.style!.backgroundColor!.resolve({}), BuddyColors.quiet);
      expect(quietButtonOnFrame(theme).backgroundColor!.resolve({}), BuddyColors.surface);
    });
  });

  group("Philadelphia's clock", () {
    DateTime on(String moment) => philadelphiaNow(DateTime.parse(moment));

    test('is 5 hours behind UTC in winter', () {
      final now = on('2026-01-15T17:00:00Z');
      expect((now.month, now.day, now.hour), (1, 15, 12));
    });

    test('is 4 hours behind UTC in summer', () {
      final now = on('2026-07-15T17:00:00Z');
      expect((now.month, now.day, now.hour), (7, 15, 13));
    });

    test('gives the date in Philadelphia, which may still be yesterday in UTC terms', () {
      final now = on('2026-11-05T03:30:00Z');
      expect((now.month, now.day, now.hour), (11, 4, 22));
    });

    test('moves forward at 2 a.m. on the second Sunday of March', () {
      // In 2026 that's March 8, and 2 a.m. Eastern Standard is 7 a.m. UTC.
      expect(on('2026-03-08T06:59:00Z').hour, 1);
      expect(on('2026-03-08T07:00:00Z').hour, 3);
    });

    test('moves back at 2 a.m. on the first Sunday of November', () {
      // In 2026 that's November 1, and 2 a.m. Eastern Daylight is 6 a.m. UTC.
      expect(on('2026-11-01T05:59:00Z').hour, 1);
      expect(on('2026-11-01T06:00:00Z').hour, 1);
      expect(on('2026-11-01T07:00:00Z').hour, 2);
    });

    test('works out the Sundays for any year', () {
      // In 2027 they're March 14 and November 7.
      expect(on('2027-03-14T06:59:00Z').hour, 1);
      expect(on('2027-03-14T07:00:00Z').hour, 3);
      expect(on('2027-11-07T05:59:00Z').hour, 1);
      expect(on('2027-11-07T06:00:00Z').hour, 1);
    });
  });
}
