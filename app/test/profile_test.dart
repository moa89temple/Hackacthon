import 'package:buddy/backend/buddy_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

ProfileFact fact(int id, String text, {bool edited = false}) => ProfileFact(
      id: id,
      text: text,
      isFromConversation: true,
      savedAt: DateTime(2026, 11, 2, 12),
      wasEdited: edited,
    );

Future<void> openYouTab(WidgetTester tester, FakeBackend backend) async {
  await openUnlockedApp(tester, backend);
  await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('You')));
  await settleApp(tester);
}

Future<void> openEditDialog(WidgetTester tester, String factText) async {
  await tester.tap(find.bySemanticsLabel('Edit: $factText'));
  await tester.pumpAndSettle();
}

Future<void> confirmDelete(WidgetTester tester, String factText) async {
  await tester.tap(find.bySemanticsLabel('Delete: $factText'));
  await tester.pumpAndSettle();
  await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Delete')));
  await tester.pumpAndSettle();
}

void main() {
  group('the list of facts', () {
    testWidgets('shows each fact with where it came from', (tester) async {
      await openYouTab(tester, FakeBackend()..facts = [fact(1, 'Is a junior.'), fact(2, 'Commutes.', edited: true)]);

      expect(find.text('What Buddy knows about you'), findsOneWidget);
      expect(find.text('Is a junior.'), findsOneWidget);
      expect(find.text('From your chat on Monday, November 2, 2026.'), findsOneWidget);
      expect(find.text('From your chat on Monday, November 2, 2026. You edited it.'), findsOneWidget);
    });

    testWidgets('says so when Buddy knows nothing yet', (tester) async {
      await openYouTab(tester, FakeBackend());

      expect(find.textContaining('Nothing yet'), findsOneWidget);
    });

    testWidgets('offers a retry when it cannot be loaded', (tester) async {
      final backend = FakeBackend()..factsError = const BackendException('offline');
      await openYouTab(tester, backend);

      expect(find.textContaining("can't reach Buddy"), findsOneWidget);

      backend
        ..factsError = null
        ..facts = [fact(1, 'Is a junior.')];
      await tester.tap(find.text('Try again'));
      await settleApp(tester);

      expect(find.text('Is a junior.'), findsOneWidget);
    });

    testWidgets('picks up what Buddy saved when the Student comes back to the tab', (tester) async {
      final backend = FakeBackend();
      await openYouTab(tester, backend);
      expect(find.textContaining('Nothing yet'), findsOneWidget);

      backend.facts = [fact(1, 'Is a junior.')];
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Buddy')));
      await settleApp(tester);
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('You')));
      await settleApp(tester);

      expect(find.text('Is a junior.'), findsOneWidget);
    });

    testWidgets('picks up what Buddy saved when a reply finishes while the tab is open', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, "I'm a junior");
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('You')));
      await settleApp(tester);
      expect(find.textContaining('Nothing yet'), findsOneWidget);

      backend.facts = [fact(1, 'Is a junior.')];
      backend.reply.add(ReplyDone(buddy('Nice.')));
      await backend.reply.close();
      await settleApp(tester);

      expect(find.text('Is a junior.'), findsOneWidget);
    });
  });

  group('editing a fact', () {
    testWidgets('sends the new words and shows them', (tester) async {
      final backend = FakeBackend()..facts = [fact(1, 'Is a junior.')];
      await openYouTab(tester, backend);

      await openEditDialog(tester, 'Is a junior.');
      await tester.enterText(find.widgetWithText(TextField, 'Is a junior.'), '  Is a senior.  ');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      expect(backend.edits, [(1, 'Is a senior.')]);
      expect(find.text('Is a senior.'), findsOneWidget);
      expect(find.text('Is a junior.'), findsNothing);
      expect(find.textContaining('You edited it.'), findsOneWidget);
    });

    testWidgets('changes nothing on Cancel', (tester) async {
      final backend = FakeBackend()..facts = [fact(1, 'Is a junior.')];
      await openYouTab(tester, backend);

      await openEditDialog(tester, 'Is a junior.');
      await tester.enterText(find.widgetWithText(TextField, 'Is a junior.'), 'Something else');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(backend.edits, isEmpty);
      expect(find.text('Is a junior.'), findsOneWidget);
    });

    testWidgets('cannot save an empty fact', (tester) async {
      await openYouTab(tester, FakeBackend()..facts = [fact(1, 'Is a junior.')]);

      await openEditDialog(tester, 'Is a junior.');
      await tester.enterText(find.widgetWithText(TextField, 'Is a junior.'), '   ');
      await tester.pump();

      expect(tester.widget<TextButton>(find.widgetWithText(TextButton, 'Save')).onPressed, isNull);
    });

    testWidgets('shows the note when Buddy hid something in the edit', (tester) async {
      final backend = FakeBackend()
        ..facts = [fact(1, 'Is a junior.')]
        ..nextEditResult = EditedFact(
          fact: fact(1, 'Card is [card number hidden]', edited: true),
          hiddenNote: 'Buddy hid what looks like a card number before saving this or sending it to the AI.',
        );
      await openYouTab(tester, backend);

      await openEditDialog(tester, 'Is a junior.');
      await tester.enterText(find.widgetWithText(TextField, 'Is a junior.'), 'Card is 4111 1111 1111 1111');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      expect(find.text('Card is [card number hidden]'), findsOneWidget);
      expect(find.textContaining('Buddy hid what looks like a card number'), findsOneWidget);
      expect(find.textContaining('4111'), findsNothing);
    });

    testWidgets('keeps the old words and says so when the change fails', (tester) async {
      final backend = FakeBackend()
        ..facts = [fact(1, 'Is a junior.')]
        ..changeError = const BackendException('offline');
      await openYouTab(tester, backend);

      await openEditDialog(tester, 'Is a junior.');
      await tester.enterText(find.widgetWithText(TextField, 'Is a junior.'), 'Is a senior.');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      expect(find.text('Is a junior.'), findsOneWidget);
      expect(find.textContaining("couldn't make that change"), findsOneWidget);
    });
  });

  group('deleting a fact', () {
    testWidgets('asks first, then removes only that fact', (tester) async {
      final backend = FakeBackend()..facts = [fact(1, 'Is a junior.'), fact(2, 'Commutes.')];
      await openYouTab(tester, backend);

      await confirmDelete(tester, 'Is a junior.');

      expect(backend.deletions, [1]);
      expect(find.text('Is a junior.'), findsNothing);
      expect(find.text('Commutes.'), findsOneWidget);
    });

    testWidgets('does nothing on Cancel', (tester) async {
      final backend = FakeBackend()..facts = [fact(1, 'Is a junior.')];
      await openYouTab(tester, backend);

      await tester.tap(find.bySemanticsLabel('Delete: Is a junior.'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(backend.deletions, isEmpty);
      expect(find.text('Is a junior.'), findsOneWidget);
    });

    testWidgets('keeps the fact and says so when the change fails', (tester) async {
      final backend = FakeBackend()
        ..facts = [fact(1, 'Is a junior.')]
        ..changeError = const BackendException('offline');
      await openYouTab(tester, backend);

      await confirmDelete(tester, 'Is a junior.');

      expect(find.text('Is a junior.'), findsOneWidget);
      expect(find.textContaining("couldn't make that change"), findsOneWidget);
    });
  });

  group('accessibility', () {
    testWidgets('a screen reader hears which fact each button is for', (tester) async {
      final handle = tester.ensureSemantics();
      await openYouTab(tester, FakeBackend()..facts = [fact(1, 'Is a junior.'), fact(2, 'Commutes.')]);

      for (final label in ['Edit: Is a junior.', 'Delete: Is a junior.', 'Edit: Commutes.', 'Delete: Commutes.']) {
        expect(find.bySemanticsLabel(label), findsOneWidget, reason: label);
      }
      handle.dispose();
    });

    testWidgets('the result of a change is announced', (tester) async {
      final handle = tester.ensureSemantics();
      await openYouTab(tester, FakeBackend()..facts = [fact(1, 'Is a junior.')]);

      await confirmDelete(tester, 'Is a junior.');

      final note = find.bySemanticsLabel('Deleted that fact.');
      expect(tester.getSemantics(note).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('the list and the dialogs meet the tap target, label and contrast guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      await openYouTab(tester, FakeBackend()..facts = [fact(1, 'Is a junior.')]);

      Future<void> expectGuidelines() async {
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      }

      await expectGuidelines();
      await openEditDialog(tester, 'Is a junior.');
      await expectGuidelines();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      await tester.tap(find.bySemanticsLabel('Delete: Is a junior.'));
      await tester.pumpAndSettle();
      await expectGuidelines();
      handle.dispose();
    });

    testWidgets('the list and the dialogs fit at twice the text size on a small phone', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 640)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      const longFact = 'Works twenty hours a week at a pharmacy near campus and needs Fridays off for it.';
      await openYouTab(tester, FakeBackend()..facts = [fact(1, longFact)]);
      expect(tester.takeException(), isNull, reason: 'overflow on the list');

      await tester.ensureVisible(find.text('Edit'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Edit'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'overflow in the edit dialog');
      expect(find.text('Save').hitTestable(), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('Delete'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'overflow in the delete dialog');
      await tester.ensureVisible(find.descendant(of: find.byType(AlertDialog), matching: find.text('Delete')));
      await tester.pumpAndSettle();
      expect(find.descendant(of: find.byType(AlertDialog), matching: find.text('Delete')).hitTestable(), findsOneWidget);
    });
  });
}
