import 'package:buddy/backend/buddy_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

VoidCallback? sendButtonAction(WidgetTester tester) =>
    tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.send)).onPressed;

void main() {
  group('the four tabs', () {
    testWidgets('are Buddy, Today, Roadmap and You', (tester) async {
      await openUnlockedApp(tester, FakeBackend());

      final bar = find.byType(NavigationBar);
      for (final label in ['Buddy', 'Today', 'Roadmap', 'You']) {
        expect(find.descendant(of: bar, matching: find.text(label)), findsOneWidget);
      }
      expect(find.byType(NavigationDestination), findsNWidgets(4));
    });

    testWidgets('use Temple cherry red as the accent color', (tester) async {
      await openUnlockedApp(tester, FakeBackend());

      final context = tester.element(find.byType(NavigationBar));
      expect(Theme.of(context).colorScheme.primary, const Color(0xFF9D2235));
    });

    testWidgets('the You tab carries the prototype note', (tester) async {
      await openUnlockedApp(tester, FakeBackend());

      await tester.tap(find.text('You'));
      await tester.pump();

      expect(
        find.text('Hackathon prototype, not an official Temple University service'),
        findsOneWidget,
      );
    });

    testWidgets('keep a reply streaming while the Student looks at another tab', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'Hello');
      backend.reply.add(const ReplyText('Hi '));
      await tester.pump();

      await tester.tap(find.text('Today'));
      await tester.pump();
      backend.reply.add(const ReplyText('there'));
      await tester.pump();
      await tester.tap(find.widgetWithText(NavigationDestination, 'Buddy'));
      await tester.pump();

      expect(find.text('Hi there'), findsOneWidget);
    });
  });

  group('the conversation', () {
    testWidgets('is there when the app opens', (tester) async {
      await openUnlockedApp(
        tester,
        FakeBackend(history: [student('Hello'), buddy('Hi, I am Buddy.')]),
      );

      expect(find.text('Hello'), findsOneWidget);
      expect(find.text('Hi, I am Buddy.'), findsOneWidget);
    });

    testWidgets('offers a retry when the history cannot be loaded', (tester) async {
      final backend = FakeBackend()..historyError = const BackendException('offline');
      await openUnlockedApp(tester, backend);

      expect(find.textContaining("can't reach Buddy"), findsOneWidget);

      backend
        ..historyError = null
        ..history = [buddy('Back again.')];
      await tester.tap(find.text('Try again'));
      await tester.pump();
      await tester.pump();

      expect(find.text('Back again.'), findsOneWidget);
      expect(find.textContaining("can't reach Buddy"), findsNothing);
    });

    testWidgets('sends the message once and clears the box', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);

      await sendMessage(tester, 'What is a hold?');

      expect(backend.sent, ['What is a hold?']);
      expect(find.text('What is a hold?'), findsOneWidget);
      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.controller!.text, isEmpty);
    });

    testWidgets('does not send an empty message', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);

      await tester.enterText(find.byType(TextField), '   ');
      await tester.pump();

      expect(sendButtonAction(tester), isNull);
      expect(backend.sent, isEmpty);
    });

    testWidgets('shows the reply as it streams in, then the final message', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'What is a hold?');

      backend.reply.add(const ReplyText('A hold '));
      await tester.pump();
      expect(find.text('A hold '), findsOneWidget);

      backend.reply.add(const ReplyText('stops registration.'));
      await tester.pump();
      expect(find.text('A hold stops registration.'), findsOneWidget);

      backend.reply.add(ReplyDone(buddy('A hold stops registration.')));
      await backend.reply.close();
      await tester.pump();
      expect(find.text('A hold stops registration.'), findsOneWidget);
    });

    testWidgets('holds further messages until the reply has finished', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'First');

      await tester.enterText(find.byType(TextField), 'Second');
      await tester.pump();
      expect(sendButtonAction(tester), isNull);

      backend.reply.add(ReplyDone(buddy('Done.')));
      await backend.reply.close();
      await tester.pump();
      expect(sendButtonAction(tester), isNotNull);
    });

    testWidgets('replaces a partial reply with the final one when Buddy declines', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'Hello');

      backend.reply.add(const ReplyText('Partial wor'));
      await tester.pump();
      backend.reply.add(ReplyDone(buddy("I can't help with that one.")));
      await backend.reply.close();
      await tester.pump();

      expect(find.textContaining('Partial wor'), findsNothing);
      expect(find.text("I can't help with that one."), findsOneWidget);
    });

    testWidgets('shows the error and drops the partial reply when the turn fails', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'Hello');

      backend.reply.add(const ReplyText('Half a rep'));
      await tester.pump();
      backend.reply.add(const ReplyFailed('Please try again.'));
      await backend.reply.close();
      await tester.pump();

      expect(find.textContaining('Half a rep'), findsNothing);
      expect(find.text('Please try again.'), findsOneWidget);
      expect(find.text('Hello'), findsOneWidget);
    });

    testWidgets('shows an error when the connection drops before the reply ends', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'Hello');

      backend.reply.add(const ReplyText('Half a rep'));
      await tester.pump();
      await backend.reply.close();
      await tester.pump();

      expect(find.textContaining('Half a rep'), findsNothing);
      expect(find.textContaining('cut off from Buddy'), findsOneWidget);
      expect(sendButtonAction(tester), isNull);

      await tester.enterText(find.byType(TextField), 'Again');
      await tester.pump();
      expect(sendButtonAction(tester), isNotNull);
    });
  });

  group('accessibility', () {
    testWidgets('screen readers hear who said what', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(
        tester,
        FakeBackend(history: [student('Hello'), buddy('Hi, I am Buddy.')]),
      );

      expect(find.bySemanticsLabel('You said: Hello'), findsOneWidget);
      expect(find.bySemanticsLabel('Buddy said: Hi, I am Buddy.'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a screen reader hears the finished reply, not every chunk', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'Hello');

      backend.reply.add(const ReplyText('Partly writ'));
      await tester.pump();
      expect(find.bySemanticsLabel('Buddy is writing a reply'), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('Partly writ')), findsNothing);

      backend.reply.add(ReplyDone(buddy('Fully written.')));
      await backend.reply.close();
      await tester.pump();
      final reply = find.bySemanticsLabel('Buddy said: Fully written.');
      expect(reply, findsOneWidget);
      expect(tester.getSemantics(reply).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('earlier messages are not announced when the app opens', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend(history: [buddy('From before.')]));

      final message = find.bySemanticsLabel('Buddy said: From before.');
      expect(tester.getSemantics(message).flagsCollection.isLiveRegion, isFalse);
      handle.dispose();
    });

    testWidgets('every tab meets the tap target, label and contrast guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend(history: [student('Hello'), buddy('Hi there.')]));

      for (final label in ['Buddy', 'Today', 'Roadmap', 'You']) {
        await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(label)));
        await tester.pump();
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      }
      handle.dispose();
    });

    testWidgets('every tab fits at twice the text size on a small phone', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 640)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      await openUnlockedApp(
        tester,
        FakeBackend(history: [student('Hello'), buddy('A reply long enough to wrap onto several lines of text.')]),
      );

      for (final label in ['Buddy', 'Today', 'Roadmap', 'You']) {
        await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(label)));
        await tester.pump();
        expect(tester.takeException(), isNull, reason: 'overflow on the $label tab');
      }
    });
  });
}
