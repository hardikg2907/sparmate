---
id: b3-notification-service
track: lld
title: Notification Service
difficulty: medium
tags: [strategy, decorator, observer, retry, message-templates]
tracker:
  section: "### B3. Applied Practice — Classic LLD Problems"
  bullet: "Notification Service (class-level)"
notesFile: notes/b3-notification-service.md
lldFolder: notification-service
---

## Opening prompt

Design a notification service. Build it as a running, in-memory C++ program, with a `main()` that shows it working.

## Hidden facts

Reveal a fact only when the candidate asks about it. Never volunteer the list.

- **What happens:** another part of the product tells the service that something happened to a user, for example an order shipped. The service decides which channels to use, builds the text for each, sends it, retries failures and keeps a log. The call is synchronous: it returns after every channel is done. No background threads in the first version.
- **Channels:** email, SMS and push. One interface for all three. A notification goes to every channel the user has enabled for that type. It is not "first success wins" and there is no fallback to another channel. The service tries channels in the order email, SMS, push.
- **Senders:** no real network. Each channel has a fake sender. It keeps every message it accepts in an outbox, counts its calls, and can be told to fail the next N calls and then succeed again. The demo must show a failure. A failed send means the provider refused the message. There is no error text, and every failure is retried the same way. Whether `send` shows it as a `bool`, a status or an exception is their choice.
- **Types:** 3, fixed for the demo: `ORDER_SHIPPED`, `PAYMENT_FAILED`, `PROMO`. Adding a type must be new data (message templates), not a new code branch.
- **Users:** set up before the demo; there is no sign-up flow. A user has an id and at most one contact per channel: an email address, a phone number, a push token. They are plain strings with no format check. A user may have no contact for a channel, for example no phone. Users and contacts do not change once `notify` calls start.
- **Message templates:** one text per type and channel, with placeholders in curly braces such as `{orderId}`. They are set at setup. (Say "message templates" to the candidate, to avoid mixing them up with C++ templates.)
- **Rendering rules:** the caller passes the values as a map of name to string. Extra values are ignored. A placeholder with no value is an error. A placeholder may appear twice, and both are replaced. Templates are always well formed: every `{` starts a placeholder. Email has a body only, with no subject and no HTML. There is no length limit. Values go in as literal text and are never scanned again, so a value that contains `{orderId}` stays as written. No escaping and no formatting.
- **Missing text:** a type and channel pair with no message template is a setup mistake. The call is rejected, the same as a missing value. Setup always covers every pair in the demo.
- **Render before send:** the service renders the text for every channel it will try before it sends anything. One bad template or value rejects the whole call. Nothing is sent and nothing is logged. A channel that will be skipped is not rendered.
- **Preferences:** per user, per channel, per type: on or off. The default is on. A change applies from the next notification, in both directions. There are no mandatory alerts in the first version. If they ask, say "not in the first version", and accept a `mandatory` flag on the type if they propose it.
- **Skipped channels:** a channel is skipped when the user switched it off for that type, or has no contact for it. A skipped channel is not tried, not retried, and gets no log row. If every channel is skipped, the call still succeeds and the log has no rows for it.
- **Retries:** if a send fails, the service tries again at once. There is no waiting. **3 attempts in total per channel**: the first try plus 2 retries. The number must be configurable, and one value serves all channels. A success ends the loop. After the third failure the channel is `FAILED` and the call still returns normally. Channels are independent: one failing channel never stops the others. If they propose a delay between retries, accept it, but there is no sleeping and no system clock: the retry becomes a later call that carries the time.
- **Delivery log:** one row per send attempt: notification id, channel, attempt number (starting at 1), status `SENT` or `FAILED`, and the minute of the call. A test can read it by notification id. No error text. It lives in memory and grows without limit. Rows are never deleted.
- **Ids and result:** every accepted call gets the next notification id, starting at 1 with no gaps. The call returns that id. The caller sees per-channel results only through the log. A rejected call returns an error the caller can see, uses no id, and changes nothing. One error style throughout: an empty `optional`, an error code or an exception.
- **Callers:** other code calls `notify` directly. If they propose Observer (event sources publish, the service subscribes), accept it, but do not require it.
- **Threads:** yes. Many callers at once, up to about 16 threads. A real provider call takes 100 ms to 2 seconds. `main()` may stay single-threaded for the demo.
- **Time:** the caller passes the time in as whole minutes on every call. Never the system clock. The first version uses it only for log rows.
- **Size:** up to about 100,000 users, about 50 notifications per second, and a few million log rows. A scan over the log is fine for the demo. With 16 threads and slow providers, the synchronous version cannot keep up with 50 per second. That is known and accepted for the first version. A queue with a worker pool is the next step.
- **Not in the first version:** rate limits, priorities, quiet hours and suppressing duplicates. If they ask, say "not in the first version".
- **Out of scope:** real providers, bounces and delivery receipts, scheduling for later, batching or digests, unsubscribe links, translations, saving to disk, a UI, sign-in.

## Expected requirements

Core:
1. Set up users with contacts, templates and one sender per channel, all on one interface. *Ask: Which channels exist, and how are messages sent?*
2. `notify(user, type, values, minute)`: render, send and log per enabled channel; return an id. *Ask: What happens when a notification is requested?*
3. Reject an unknown user, a missing value or a missing template; a rejected call does nothing. *Ask: What if the request is bad or incomplete?*
4. At most 3 attempts per channel in total; a failing channel does not stop the others. *Ask: How many times do we retry, and does one failure stop the rest?*
5. `setPreference(user, channel, type, on)`. The default is on. The next notification obeys it. *Ask: Can a user turn a kind of message off, and what is the default?*
6. A delivery log with one row per attempt, readable by notification id. *Ask: What must be recorded about each delivery?*
7. Safe under concurrent `notify` and `setPreference` calls, with no lock held during a send. *Ask: Can several threads use it at once?*

Extras (credit when they name one, never a gap):
- Fake senders that fail on command. The demo shows a success, a skip, a retry that works and a retry that gives up.
- Only channels with a contact are used; failures are retried and every attempt is logged.
- A rejected call sends nothing, logs nothing and uses no id.

## Entities and relationships

- `Channel`, `NotificationType` and `Status` (all `enum class`). `Channel` order is the try order.
- `User` (struct): id and a map from channel to contact. A missing key means no contact.
- `Message` (struct): notification id, channel, address, body, attempt number, minute. It carries everything a decorator needs, so no decorator reaches outside.
- `DeliveryRecord` (struct): notification id, channel, attempt, status, minute. **The hidden noun.** Many candidates log strings to `cout` or keep a `vector<string>`, and then nothing can read the result back.
- `ChannelSender` (interface) with `FakeSender`. `RetryingSender` and `LoggingSender` are Decorators over any `ChannelSender`.
- `DeliveryLog`: the rows and their own lock.
- `MessageTemplates`: type and channel to text, plus `render`.
- `NotificationService`: owns users, the sender per channel, the templates, the switched-off preferences, the id counter and the lock.
- Not stored: the rendered text (it lives only inside the `Message`), the user's name (the caller passes it as a value), and a notification status (the log is the status).

## Behaviour and states

- `notify`: take the lock, find the user, walk the senders in channel order, skip switched-off or contact-less channels, render every remaining channel, and reject if any render fails. Then take the next id and release the lock. Now send on each channel with no service lock held. The sender stack writes the log rows.
- Retry: `RetryingSender::send` copies the message, calls the inner sender up to the maximum, sets `attempt` on the copy before each try, and returns true on the first success.
- `setPreference(user, channel, type, on)`: reject an unknown user. Otherwise insert into or erase from the switched-off set. Doing it twice is harmless.
- `deliveries(id)` returns the rows for that id. An unknown id gives an empty list.
- A delivery attempt ends as `SENT` or `FAILED`. A notification has no stored state, because every channel is done before `notify` returns. The State pattern has nothing to do.
- The sender map, the templates and the users never change after setup, so reading them needs no lock. Preferences and the id counter do change, so they sit behind the lock. The reference reads the users inside the same locked step, which is also fine.
- A reader can see an id whose rows are not all written yet while sends are running. That is fine.

## Reference design

```
 enum class Channel { EMAIL, SMS, PUSH };                      // enum order is the try order
 enum class NotificationType { ORDER_SHIPPED, PAYMENT_FAILED, PROMO };
 enum class Status { SENT, FAILED };
 using Values = std::map<std::string, std::string>;

 struct User           { int id; std::map<Channel, std::string> contact; };
 struct Message        { int notificationId; Channel channel; std::string to, body; int attempt; int minute; };
 struct DeliveryRecord { int notificationId; Channel channel; int attempt; Status status; int minute; };

 class ChannelSender {                                         // interface
  public:
   virtual ~ChannelSender() = default;
   virtual bool send(const Message& m) = 0;                    // true = the provider accepted it
 };
 class FakeSender     : public ChannelSender { ... outbox, calls, failNext, own mutex ... };
 class RetryingSender : public ChannelSender { ... shared_ptr<ChannelSender> inner; int maxAttempts; ... };   // copy m, loop 1..max, set attempt on the copy
 class LoggingSender  : public ChannelSender { ... inner; shared_ptr<DeliveryLog> log; ... };                 // one row per call

 class NotificationService {
   std::map<int, User> users;
   std::map<Channel, std::shared_ptr<ChannelSender>> senders;  // each is Retrying(Logging(real sender))
   MessageTemplates templates;                                 // map<pair<type, channel>, string>
   std::set<std::tuple<int, Channel, NotificationType>> off;   // switched-off pairs; default is on
   std::shared_ptr<DeliveryLog> log;                           // rows + its own mutex
   int nextId = 1;
   std::mutex mtx;                                             // off, nextId (and the users read in the same step)
  public:
   std::optional<int> notify(int userId, NotificationType type, const Values& values, int minute);
   bool setPreference(int userId, Channel c, NotificationType t, bool on);
   std::vector<DeliveryRecord> deliveries(int notificationId);
 };
```

```
 notify(user, type, values, minute)
   |  lock: user? -> channels with contact and preference on -> render all -> take id
   v
   for each channel, in order:      Retrying -> Logging -> sender      (no service lock held)
   v
   return id                        rows were added by LoggingSender, one per attempt
```

`Logging` sits inside `Retrying`, so every attempt gets a row. Reverse the order and the log gets one row per channel, with no attempt count. A `std::map` keyed by channel makes a new channel one more entry, not one more branch. A plain retry loop inside `notify` is an equal answer to the two Decorators.

## Patterns that fit

- **Strategy (a channel interface):** one class per channel behind `ChannelSender`. The dispatch loop names no channel.
- **Decorator:** retry and logging wrap any sender. The wrapping order matters, as shown above. It only fits if the log row can still say which attempt it was, and `Message.attempt` does that.
- **Observer:** only at the edge. An event source publishes and the service subscribes and calls `notify`. Accept it. Do not let it take more than a few minutes.
- Not needed: Singleton service, Factory for senders (a map filled in `main` is enough), State, Chain of Responsibility, and an interface for the template engine or the preference store.

## Demo scenarios

Setup for every scenario unless it says "continues": three fake senders, 3 attempts maximum, all preferences on, and these message templates.

| Type | EMAIL | SMS | PUSH |
|---|---|---|---|
| `ORDER_SHIPPED` | `Hi {name}, order {orderId} has shipped.` | `Order {orderId} has shipped.` | `Order {orderId} is on its way.` |
| `PAYMENT_FAILED` | `Hi {name}, payment failed for order {orderId}.` | `Payment failed for order {orderId}.` | `Payment of {amount} failed for order {orderId}.` |
| `PROMO` | `Hi {name}, {offer}` | `{offer}` | `{offer}` |

User 1: email `asha@x.com`, phone `+91-111`, push token `tok-1`. User 2: email `ben@x.com`, no phone, push token `tok-2`. Notification ids start at 1 in a fresh setup. Adapt the calls to the candidate's own API. A log row below means one attempt. Compare rows as a set. If the candidate logs one row per channel with an attempts count, read the counts as the same facts. Ignore any `SKIPPED` rows in every count below.

1. `notify(1, ORDER_SHIPPED, {name: Asha, orderId: 1001}, minute 7)` returns id 1. Email outbox: one message to `asha@x.com`, body `Hi Asha, order 1001 has shipped.` SMS: one to `+91-111`, body `Order 1001 has shipped.` Push: one to `tok-1`, body `Order 1001 is on its way.` The log for id 1 has 3 rows: EMAIL, SMS, PUSH, each attempt 1, `SENT`, minute 7.
2. User 1 switches SMS off for `ORDER_SHIPPED`. The same notify at minute 5 returns id 1. Email and push each hold one message. The SMS sender got 0 calls and its outbox is empty. The log has 2 rows (EMAIL, PUSH), both `SENT`. No SMS row.
3. Continues 2. `notify(1, PAYMENT_FAILED, {name: Asha, orderId: 1002, amount: 499}, 6)` returns id 2 and goes out on all 3 channels. Preferences are per type. Email `Hi Asha, payment failed for order 1002.` SMS `Payment failed for order 1002.` Push `Payment of 499 failed for order 1002.` Then user 1 switches SMS back on for `ORDER_SHIPPED` and notifies `ORDER_SHIPPED` (name Asha, orderId 1003) at minute 8. It returns id 3 and has 3 `SENT` rows including SMS. The rows for id 1 still number 2.
4. `notify(2, ORDER_SHIPPED, {name: Ben, orderId: 1003}, 0)` returns id 1. Email to `ben@x.com`: `Hi Ben, order 1003 has shipped.` Push to `tok-2`: `Order 1003 is on its way.` SMS has no call and no row. 2 rows, both `SENT`.
5. User 1 switches all 3 channels off for `PROMO`. `notify(1, PROMO, {name: Asha, offer: 20% off today}, 0)` is accepted and returns id 1. No sender got a call, every outbox is empty, and the log has no rows. No error.
6. The SMS sender is told to fail the next 2 calls. `notify(1, ORDER_SHIPPED, {name: Asha, orderId: 1001}, 3)` returns id 1. The SMS sender got 3 calls and its outbox holds exactly 1 message. SMS rows: attempt 1 `FAILED`, attempt 2 `FAILED`, attempt 3 `SENT`. Email and push have 1 `SENT` row each. 5 rows in total.
7. The SMS sender is told to fail the next 3 calls. The same notify at minute 3 returns id 1 and does not throw. The SMS sender got exactly 3 calls (no 4th) and its outbox is empty. SMS rows: attempts 1, 2, 3, all `FAILED`. Email and push still have 1 `SENT` row each and hold their messages. 5 rows in total.
8. Continues 7. `notify(1, ORDER_SHIPPED, {name: Asha, orderId: 1002}, 4)` returns id 2. The SMS sender has no failures left. Its total calls are 4. Id 2 has 3 rows, all attempt 1 and `SENT`. Id 1 still shows its 3 `FAILED` SMS rows. 8 rows in total.
9. `notify(1, PAYMENT_FAILED, {name: Asha, orderId: 1002}, 0)` has no `amount`. Only the push text needs it, but the whole call is rejected. Email and SMS would render fine and are not sent. No sender got a call, every outbox is empty, and the log has no rows. The next valid notify returns id 1. If they never asked what a bad value does and chose another rule, judge it against their own stated rule.
10. `notify(99, ORDER_SHIPPED, {name: X, orderId: 1}, 0)` is rejected. `setPreference(99, SMS, PROMO, off)` is rejected. Nothing changes: no calls, no rows, no new user. The next valid notify returns id 1.
11. `notify(1, ORDER_SHIPPED, {name: "{orderId}", orderId: 1001, coupon: SAVE5}, 0)` returns id 1. The email body is exactly `Hi {orderId}, order 1001 has shipped.` The SMS body is `Order 1001 has shipped.` The extra key `coupon` is ignored.
12. Only if the candidate made it thread-safe: 8 threads each call `notify(1, ORDER_SHIPPED, ...)` 1,000 times with healthy senders. Every call returns an id. The ids are exactly 1 to 8,000, none repeated and none missing. Each outbox holds exactly 8,000 messages. The log has exactly 24,000 rows, and each id has exactly 3. A `-fsanitize=thread` build reports no race. Lock-scope check, only if their fake can be given a delay: the email fake waits 50 ms per call, outside its own lock, and 8 threads make 20 calls each. With no lock held during a send, the run takes about 1 second (20 sends in a row per thread). With a lock held over the sends, it takes about 8 seconds (160 sends in a row). If the fake has no delay setting, ask them to explain the lock scope instead.

## Extensions

Pick one. Give a second only if more than 10 minutes remain. Extension 2 is the quickest to judge. Use it first if the candidate's dispatch code names channels.

1. **Per-user rate limit:** a user gets at most 5 notifications in any 60 minutes. A call at minute `m` counts the earlier accepted calls with a minute greater than `m - 60`. A limited call is rejected, uses no id, sends nothing, logs nothing and does not count. `PAYMENT_FAILED` is exempt: never limited, never counted. State this when you give the extension. Any accepted call counts, even if every channel is skipped. A call rejected for any other reason never counts. Assume the minutes for one user never go backwards. Expect: a `RateLimiter` with `allow(userId, type, minute)` that checks and records in one step. It is injected into the service and called once in the locked part of `notify`, with a "no limit" default. It runs last in that part, after the user lookup and the render check and just before the id is taken. That is how a rejected call stays uncounted. The send loop is untouched. Check, user 1, `ORDER_SHIPPED` (every `PAYMENT_FAILED` call carries an `amount`): minutes 0, 10, 20, 30, 40 are accepted (ids 1 to 5). Minute 50 is rejected, but `PAYMENT_FAILED` at minute 50 is accepted (id 6). Minute 59 is rejected, 60 is accepted (id 7), 61 is rejected, 70 is accepted (id 8). User 2 at minute 50 is accepted at any point and takes the next id, because one user never limits another. Must stay the same: scenarios 1 to 11 below the limit, retries, log rows, and rejected calls using no id. Telling a limited call apart from other rejections is a stretch signal.
2. **A fourth channel, chat:** delivered to a chat handle, a new contact on the user. Add the message templates `ORDER_SHIPPED` `Order {orderId} has shipped.`, `PAYMENT_FAILED` `Payment failed for order {orderId}.` and `PROMO` `{offer}`. Expect: a new enum value, a new sender class, one more entry in the sender map (wrapped like the others), and 3 rows of template data. `notify`, `RetryingSender` and `LoggingSender` stay untouched. Check: user 1 gets handle `@asha`, and `ORDER_SHIPPED` returns 4 `SENT` rows (EMAIL, SMS, PUSH, CHAT). User 2 has no handle and gets exactly the 2 rows of scenario 4, with no chat row. With the chat sender told to fail the next 2 calls, the chat rows read `FAILED`, `FAILED`, `SENT` with no new retry code. Must stay the same: scenarios 1 to 11, the on-by-default rule (a user with a handle gets chat until they switch it off), and the try order, with chat last.
3. **Priority ordering:** callers stop waiting for slow providers. `submit(user, type, values, priority, minute)` validates, takes the id in arrival order, queues, and returns the id. Priorities are `HIGH`, `NORMAL`, `LOW`. `processNext(minute)` and `processAll(minute)` deliver the highest priority first, and first-in first-out inside one priority. No background thread: the caller drives processing. The log rows carry the minute given to `processNext` or `processAll`. Expect: a queue in front of the existing delivery code (a `std::priority_queue` ordered by priority then id, or one queue per priority). The delivery code stays as it is. Check, user 1: submit A `LOW` (orderId 1001, id 1), B `NORMAL` (1002, id 2), C `HIGH` (1003, id 3), D `NORMAL` (1004, id 4), E `HIGH` (1005, id 5). Before processing, every outbox and the log are empty. `processAll(10)` delivers in the order 3, 5, 2, 4, 1, so the email outbox order is orderIds 1003, 1005, 1002, 1004, 1001. Variant: `processNext` twice (ids 3, 5), then submit F `HIGH` (1006, id 6), then `processAll` gives 6, 2, 4, 1. Must stay the same: rejection at submit with no id used, retries inside one notification (a failing SMS never moves the next notification), and the rows per notification. Reading preferences at submit and re-reading them at delivery are both accepted. Re-reading is a stretch signal, because an opt-out should win. A candidate at the stretch level also names starvation of `LOW`.

## Concurrency follow-up

"10 services call `notify` at the same moment, and one provider takes 2 seconds per call. Walk me through what is shared and what you lock."

Expect:
- Names the shared state: the id counter, the preferences, the log, each fake sender's outbox and counters (and the rate-limit window if it exists).
- Uses `std::mutex` with `std::lock_guard` in every method that touches that state, reads included. Taking the next id is check-then-act, so it sits inside the lock (or is atomic).
- Keeps the lock off the send. A lock held over a 2-second send stalls every caller and every preference change. The service copies what the send needs (the rendered messages), unlocks, sends, and the log takes its own short lock for each row.
- Gives each fake sender its own lock, and does not hold it while waiting.

Stretch signal: says the rate limiter must check and record in one locked step, because two threads could both see 4 of 5. Accepts that a reader may see an id with only some rows. Notes that one service lock plus one log lock cannot deadlock if neither is held across a call to the other. Names a queue with a worker pool as the next step, which is what extension 3 leads to.

Other probes (use one, only if time allows and they have not covered it):
- "A send times out, but the message did arrive. What happens on retry?" Expect: the user may get it twice (at-least-once). A real fix is an idempotency key per notification and channel, which the provider checks. The first version accepts duplicates and says so.
- "How would retries wait 1 minute, then 4 minutes?" Expect: no `sleep`, time as a parameter, a retry that becomes a later call or a queue with a due time.
- "How do you add a notification type?" Expect: an enum value and template data, with no new branch in the dispatch loop.

## Level bar

Hire bar must show:
- Step 1 questions that cover channels and fake senders, preferences and their default, what "3 attempts" means, what a bad value does, what the log holds, and threads.
- One interface for all channels, and a dispatch loop that names no channel (no `switch` and no `if (channel == EMAIL)` in the send path).
- `DeliveryRecord` as a real type that a test can read back.
- Retry in one place (a decorator, a loop in the dispatcher or a small policy), counted as total attempts, and never copied into each sender.
- Validation before any send: a call with a bad value sends nothing and logs nothing. The only exception is a candidate who never asked and chose another rule (see accepted alternatives).
- A program that compiles and runs scenarios 1 to 10 inside the time, with a failing fake in `main()`.
- Correct locking when asked: names the shared state and keeps the lock off the send.
- Says where the extension plugs in before they code it. A working change is enough at this level. A small and clean change is the stretch signal.

Stretch signal:
- Finds `DeliveryRecord`, the sender interface and the fan-out loop inside 15 minutes, with a compiling skeleton by minute 30.
- Treats time as a parameter without being told, and says retries wait through a caller-driven call, never `sleep`.
- Raises duplicate sends on retry and an idempotency key unprompted, and accepts them for the first version.
- Raises mandatory alerts, rows for skipped channels with a reason, or starvation in the priority queue unprompted.
- Explains the decorator order and what each order would log.
- Handles the extension with a small local change and says which existing behaviour stays the same.

Accepted alternatives (never mark these down):
- A retry loop in the dispatcher or a `RetryPolicy` instead of Decorators.
- One log row per channel with an attempts count instead of one row per attempt.
- A `SKIPPED` row with a reason for a skipped channel, if the `SENT` and `FAILED` rows match the scenarios.
- A direct `notify` call or Observer for event sources.
- Any single error style, including a sender that throws on failure while the retry code catches it.
- Preferences kept as a nested map or a small `Preferences` class, if reads use `find` and the default is on.
- A `std::shared_mutex`, an atomic id counter, or one lock for both the service state and the log, if no lock is held across a send.
- A `notify` that also returns a per-channel result, if the log still holds one row per attempt.
- A failed render that logs a `FAILED` row for that channel and still sends the others, only if they never asked what a bad value does. If the interviewer told them the whole call is rejected, they must follow that.

## Traps

- A `switch (channel)` in the send path, so a new channel means editing the dispatcher.
- The retry loop copied into every sender, or hidden inside the fake. The real senders then need it too, and a test cannot count attempts.
- An off-by-one: 3 retries (4 attempts) instead of 3 attempts. Scenario 7 catches it, because the sender must get exactly 3 calls.
- `sleep_for` between retries, or reading the system clock. The demo gets slow and untestable, and a sleep inside a lock blocks everyone.
- A delivery log made of `cout` lines or a `vector<string>`: nothing can read it back or assert on it.
- Treating a skipped channel as a failure: writing `FAILED`, or retrying a user who has no phone.
- One failing channel that throws or returns early and stops the other channels.
- Preferences as `bool smsEnabled` fields on `User`, so every new channel or type changes `User`. Nested maps with `operator[]` are the C++ version: `users[id]` inserts a ghost user, and `senders[channel]` returns a null `shared_ptr` and crashes.
- Rendering with `params[key]` that quietly inserts an empty value, so the service sends "Hi , order  has shipped." Repeated find-and-replace that scans the inserted text again is a second bug. Reaching for `std::regex` is a time sink.
- Sending channel by channel while rendering, so a bad value for the last channel leaves a half-sent notification (scenario 9).
- Holding one mutex around `send()`: "global lock, done". One slow provider then blocks every notification.
- Building an event bus with threads, a Singleton service, or an interface for every class (`ITemplateEngine`, `IPreferenceStore`) before one channel works.
- Spending more than 25 minutes on steps 1 to 3 so nothing runs at the end.
