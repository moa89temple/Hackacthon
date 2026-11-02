import 'package:buddy/backend/buddy_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

const _longReply = 'Here is a long reply that needs a lot of room on a small phone. ';

/// A conversation much longer than the screen, whose newest message is at the bottom.
FakeBackend longConversation() => FakeBackend(
      history: [
        for (var number = 1; number <= 40; number++) buddy('Older message $number'),
      ],
    );

double scrollOffset(WidgetTester tester) => tester.state<ScrollableState>(find.byType(Scrollable).first).position.pixels;

bool isOnScreen(WidgetTester tester, Finder target) {
  if (target.evaluate().isEmpty) return false;
  final list = tester.getRect(find.byType(ListView));
  final rect = tester.getRect(target);
  return rect.top < list.bottom && rect.bottom > list.top;
}

Future<void> scrollUp(WidgetTester tester, [double by = 1500]) async {
  await tester.drag(find.byType(ListView), Offset(0, by));
  await tester.pumpAndSettle();
}

void useSmallPhone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(320, 568)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  group('sending a message', () {
    testWidgets('takes a Student who had scrolled up to their new message', (tester) async {
      final backend = longConversation();
      await openUnlockedApp(tester, backend);
      await scrollUp(tester);
      expect(scrollOffset(tester), greaterThan(0));

      await sendMessage(tester, 'My new message');
      await tester.pump();

      expect(scrollOffset(tester), 0);
      expect(isOnScreen(tester, find.text('My new message')), isTrue);
    });

    testWidgets('keeps the reply in view while it is written and once it has finished', (tester) async {
      final backend = longConversation();
      await openUnlockedApp(tester, backend);
      await scrollUp(tester);

      await sendMessage(tester, 'My new message');
      await tester.pump();
      backend.reply.add(const ReplyText('The first words'));
      await tester.pump();
      await tester.pump();

      expect(isOnScreen(tester, find.text('The first words')), isTrue);

      backend.reply
        ..add(ReplyDone(buddy('The first words and the rest')))
        ..close();
      await tester.pump();
      await tester.pump();
      await tester.pump();

      expect(isOnScreen(tester, find.text('The first words and the rest')), isTrue);
    });

    testWidgets('does not move a Student who scrolled up to read while the reply was being written', (tester) async {
      final backend = longConversation();
      await openUnlockedApp(tester, backend);

      await sendMessage(tester, 'My new message');
      await tester.pump();
      backend.reply.add(const ReplyText('The first words'));
      await tester.pump();

      await scrollUp(tester);
      final readingAt = scrollOffset(tester);
      expect(readingAt, greaterThan(0));

      backend.reply.add(const ReplyText(' and more words'));
      await tester.pump();
      await tester.pump();
      expect(scrollOffset(tester), readingAt);

      backend.reply
        ..add(ReplyDone(buddy('The first words and more words')))
        ..close();
      await tester.pump();
      await tester.pump();
      await tester.pump();
      expect(scrollOffset(tester), readingAt);
    });

    testWidgets('takes them down again when they send their next message', (tester) async {
      final backend = longConversation();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'My first message');
      backend.reply
        ..add(ReplyDone(buddy('A reply')))
        ..close();
      await tester.pumpAndSettle();
      await scrollUp(tester);
      expect(scrollOffset(tester), greaterThan(0));

      backend.nextReply();
      await sendMessage(tester, 'My second message');
      await tester.pump();

      expect(scrollOffset(tester), 0);
      expect(isOnScreen(tester, find.text('My second message')), isTrue);
    });

    testWidgets('leaves the top of a reply taller than the screen where the Student can scroll to it', (tester) async {
      useSmallPhone(tester);
      final backend = longConversation();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'My new message');
      await tester.pump();
      final tall = 'The very top of the reply. ${_longReply * 30}';
      backend.reply.add(ReplyText(tall));
      await tester.pump();
      await tester.pump();

      // Scrolling up to the top while more of it arrives isn't undone by what arrives.
      await tester.drag(find.byType(ListView), const Offset(0, 400));
      await tester.pumpAndSettle();
      final readingAt = scrollOffset(tester);
      backend.reply.add(const ReplyText(' More.'));
      await tester.pump();
      await tester.pump();
      expect(scrollOffset(tester), readingAt);

      backend.reply
        ..add(ReplyDone(buddy('$tall More.')))
        ..close();
      await tester.pump();
      await tester.pump();
      await tester.pump();

      final listTop = tester.getTopLeft(find.byType(ListView)).dy;
      final reply = find.textContaining('The very top of the reply.');
      for (var drags = 0; drags < 20 && tester.getTopLeft(reply).dy < listTop; drags++) {
        await tester.drag(find.byType(ListView), const Offset(0, 200));
        await tester.pumpAndSettle();
      }
      expect(tester.getTopLeft(reply).dy, greaterThanOrEqualTo(listTop));
    });
  });

  group('reading without sending', () {
    testWidgets('leaves a Student who has scrolled up where they are', (tester) async {
      final backend = longConversation();
      await openUnlockedApp(tester, backend);
      await scrollUp(tester);
      final readingAt = scrollOffset(tester);

      await tester.pump(const Duration(seconds: 1));

      expect(scrollOffset(tester), readingAt);
    });
  });

  group('the first turn of an empty conversation', () {
    /// Looks for the event seen once on the emulator: the reply below the screen with no hand scrolling.
    Future<void> runFirstTurn(WidgetTester tester, {void Function()? betweenEvents}) async {
      final backend = FakeBackend(history: [buddy('The opening Buddy shows first.')]);
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'I want to get into PA school');
      for (final words in [_longReply * 5, _longReply * 5, _longReply * 5]) {
        backend.reply.add(ReplyText(words));
        await tester.pump();
        await tester.pump();
        betweenEvents?.call();
        await tester.pump();
      }
      final reply = 'The whole reply. ${_longReply * 15}';
      backend.reply
        ..add(ReplyDone(buddy(reply)))
        ..close();
      await tester.pump();
      await tester.pump();
      await tester.pump();
      expect(find.textContaining('The whole reply.'), findsOneWidget);
    }

    testWidgets('stays at the bottom with nothing else going on', (tester) async {
      useSmallPhone(tester);
      await runFirstTurn(tester);

      expect(scrollOffset(tester), 0);
      expect(tester.getBottomLeft(find.textContaining('The whole reply.')).dy, lessThanOrEqualTo(tester.getBottomLeft(find.byType(ListView)).dy));
    });

    testWidgets('stays at the bottom when the keyboard closes partway through', (tester) async {
      useSmallPhone(tester);
      tester.view.viewInsets = const FakeViewPadding(bottom: 250);
      addTearDown(tester.view.resetViewInsets);
      await runFirstTurn(tester, betweenEvents: () => tester.view.viewInsets = FakeViewPadding.zero);

      expect(scrollOffset(tester), 0);
      expect(tester.getBottomLeft(find.textContaining('The whole reply.')).dy, lessThanOrEqualTo(tester.getBottomLeft(find.byType(ListView)).dy));
    });
  });
}
