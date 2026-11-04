import 'package:buddy/backend/buddy_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

/// The card's buttons and where each one must go. These come from the ticket, not from the app.
const expectedActions = {
  'Call 988': 'tel:988',
  'Text 988': 'sms:988',
  'Text HOME to 741741': 'sms:741741?body=HOME',
  'Call 911': 'tel:911',
  'Call (215) 204-7276': 'tel:+12152047276',
};

/// The size of an ordinary phone. The card is taller than the default test window.
void useOrdinaryPhone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(412, 915)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  group('when the backend raises the card', () {
    testWidgets('shows every number at once, before any of the reply has come', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'I want to kill myself');

      backend.reply.add(const ReplyCrisisCard());
      await tester.pump();

      for (final label in expectedActions.keys) {
        expect(find.text(label), findsOneWidget, reason: label);
      }
      expect(find.text('Tuttleman Counseling at Temple'), findsOneWidget);
      expect(find.textContaining('Crisis Text Line'), findsOneWidget);
    });

    expectedActions.forEach((label, address) {
      testWidgets('tapping "$label" starts it', (tester) async {
        useOrdinaryPhone(tester);
        final backend = FakeBackend();
        final opened = <Uri>[];
        await openUnlockedApp(tester, backend, openPhone: (uri) async {
          opened.add(uri);
          return true;
        });
        await sendMessage(tester, 'I want to kill myself');
        backend.reply.add(const ReplyCrisisCard());
        await tester.pump();

        await tester.ensureVisible(find.text(label));
        await tester.pump();
        await tester.tap(find.text(label));
        await tester.pump();

        expect(opened, [Uri.parse(address)]);
      });
    });

    testWidgets('says what to do if the phone cannot open the call', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend, openPhone: (uri) async => false);
      await sendMessage(tester, 'I want to kill myself');
      backend.reply.add(const ReplyCrisisCard());
      await tester.pump();

      await tester.ensureVisible(find.text('Call 911'));
      await tester.pump();
      await tester.tap(find.text('Call 911'));
      await tester.pump();

      expect(find.textContaining("couldn't open that"), findsOneWidget);
      expect(find.textContaining('another phone'), findsOneWidget);
    });

    testWidgets('says the same if opening it throws', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend, openPhone: (uri) async => throw Exception('no handler'));
      await sendMessage(tester, 'I want to kill myself');
      backend.reply.add(const ReplyCrisisCard());
      await tester.pump();

      await tester.ensureVisible(find.text('Call 988'));
      await tester.pump();
      await tester.tap(find.text('Call 988'));
      await tester.pump();

      expect(find.textContaining("couldn't open that"), findsOneWidget);
    });

    testWidgets('stays above the reply, and the conversation carries on after it', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'I want to kill myself');

      backend.reply
        ..add(const ReplyCrisisCard())
        ..add(const ReplyText('I am '));
      await tester.pump();
      backend.reply.add(ReplyDone(buddy('I am here.')));
      await backend.reply.close();
      await tester.pump();

      expect(find.text('Call 988'), findsOneWidget);
      expect(find.text('I am here.'), findsOneWidget);
      expect(
        tester.getTopLeft(find.text('Call 988')).dy,
        lessThan(tester.getTopLeft(find.text('I am here.')).dy),
      );

      backend.nextReply();
      await sendMessage(tester, 'What is a hold?');
      backend.reply.add(ReplyDone(buddy('A hold stops registration.')));
      await backend.reply.close();
      await tester.pump();

      expect(backend.sent.last, 'What is a hold?');
      expect(find.text('A hold stops registration.'), findsOneWidget);
    });

    testWidgets('stays if Buddy fails to write a reply', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'I want to kill myself');

      backend.reply
        ..add(const ReplyCrisisCard())
        ..add(const ReplyFailed('Please try again.'));
      await backend.reply.close();
      await tester.pump();

      expect(find.text('Call 988'), findsOneWidget);
      expect(find.text('Please try again.'), findsOneWidget);
    });

    testWidgets('stays if the connection drops', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'I want to kill myself');

      backend.reply.add(const ReplyCrisisCard());
      await tester.pump();
      await backend.reply.close();
      await tester.pump();

      expect(find.text('Call 988'), findsOneWidget);
      expect(find.textContaining('cut off from Buddy'), findsOneWidget);
    });

    testWidgets('brings the Student back to the Buddy tab if they are on another one', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'Everything feels pointless');

      await goToTab(tester, 'Today');
      await tester.pump();
      backend.reply.add(const ReplyCrisisCard());
      await tester.pump();
      await tester.pump();

      expect(find.text('Call 988').hitTestable(), findsOneWidget);
    });

    testWidgets('scrolls into view if the Student had scrolled up', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend(history: [for (var i = 0; i < 40; i++) buddy('Message $i')]);
      await openUnlockedApp(tester, backend);
      await tester.drag(find.byType(ListView), const Offset(0, 2000));
      await tester.pump();
      await sendMessage(tester, 'Everything feels pointless');

      backend.reply.add(const ReplyCrisisCard());
      for (var frame = 0; frame < 4; frame++) {
        await tester.pump();
      }

      expect(find.text('Call 988').hitTestable(), findsOneWidget);
    });
  });

  group('when the conversation is reloaded', () {
    testWidgets('shows an earlier card in its place, ready to use', (tester) async {
      useOrdinaryPhone(tester);
      final opened = <Uri>[];
      await openUnlockedApp(
        tester,
        FakeBackend(history: [student('Help'), CrisisCardItem(), buddy('I am here.')]),
        openPhone: (uri) async {
          opened.add(uri);
          return true;
        },
      );

      await tester.ensureVisible(find.text('Call 911'));
      await tester.pump();
      await tester.tap(find.text('Call 911'));
      await tester.pump();

      expect(opened, [Uri.parse('tel:911')]);
    });
  });

  group('accessibility', () {
    const heading = 'Crisis help from Buddy';

    testWidgets('a screen reader announces a new card', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'I want to kill myself');

      backend.reply.add(const ReplyCrisisCard());
      await tester.pump();

      final card = find.bySemanticsLabel(RegExp(heading));
      expect(card, findsOneWidget);
      expect(tester.getSemantics(card).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('an earlier card is not announced when the app opens', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend(history: [student('Help'), CrisisCardItem()]));

      final card = find.bySemanticsLabel(RegExp(heading));
      expect(tester.getSemantics(card).flagsCollection.isLiveRegion, isFalse);
      handle.dispose();
    });

    testWidgets('a screen reader can reach every way to get help by name', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend(history: [student('Help'), CrisisCardItem()]));

      for (final label in expectedActions.keys) {
        await tester.ensureVisible(find.text(label));
        await tester.pump();
        expect(find.bySemanticsLabel(label), findsOneWidget, reason: label);
      }
      handle.dispose();
    });

    testWidgets('the card meets the tap target, label and contrast guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend(history: [student('Help'), CrisisCardItem()]));

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('the card fits at twice the text size on a small phone, starting from its top', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 640)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'I want to kill myself');
      backend.reply.add(const ReplyCrisisCard());
      for (var frame = 0; frame < 4; frame++) {
        await tester.pump();
      }

      expect(tester.takeException(), isNull);
      // The card is taller than this screen, so it starts at its title rather than its last number.
      expect(find.text('Help is here, right now').hitTestable(), findsOneWidget);
      for (final label in expectedActions.keys) {
        await tester.ensureVisible(find.text(label, skipOffstage: false));
        await tester.pump();
        expect(find.text(label).hitTestable(), findsOneWidget, reason: label);
        expect(tester.takeException(), isNull);
      }
    });
  });
}
