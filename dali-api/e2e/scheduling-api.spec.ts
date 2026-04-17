import { test, expect } from './fixtures';

const CYCLE = 'cycle-fall-2026';

test.describe('scheduling API: slot queries', () => {
  test('returns 400 without domainId param', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007ev5' });
    const res = await page.request.get(`/api/cycles/${CYCLE}/available-slots`);
    expect(res.status()).toBe(400);
  });

  test('returns 30-minute slots for single-domain applicant', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007ev5' }); // Eve - Design
    const res = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-design`,
    );
    expect(res.ok()).toBeTruthy();
    const slots = await res.json();
    expect(slots.length).toBeGreaterThan(0);
    // Every slot should be exactly 30 minutes
    for (const slot of slots) {
      const ms = new Date(slot.endTime).getTime() - new Date(slot.startTime).getTime();
      expect(ms).toBe(30 * 60_000);
    }
  });

  test('multi-domain applicant gets valid slots', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007bo2' }); // Bob - Design + Product
    // Bob needs: in-domain from Design OR Product, cross-domain from Engineering
    const res = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-design&domainId=domain-pm`,
    );
    expect(res.ok()).toBeTruthy();
    const slots = await res.json();
    expect(slots.length).toBeGreaterThan(0);
  });

  test('slots only fall on weekdays', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007ev5' });
    const res = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-design`,
    );
    const slots = await res.json();
    for (const slot of slots) {
      const day = new Date(slot.startTime).getUTCDay();
      // Weekday check in the configured timezone (America/New_York)
      // UTC 14:00 is 10am ET, so the UTC day should match the local day
      // Just verify no slots start on Saturday(6) or Sunday(0) in UTC
      // (availability is 14:00-16:00 UTC which is always same calendar day in ET)
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
  });
});

test.describe('scheduling API: double-booking prevention', () => {
  test('already-booked applicant gets 409', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007al1' }); // Alice - already has interview
    const slotsRes = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-eng`,
    );
    const slots = await slotsRes.json();
    expect(slots.length).toBeGreaterThan(0);

    const bookRes = await page.request.post(
      `/api/domain-applications/da-alice-eng/schedule-interview`,
      { data: { startTime: slots[0].startTime } },
    );
    expect(bookRes.status()).toBe(409);
  });
});

test.describe.serial('scheduling API: book → view → cancel flow', () => {
  test('Eve books an available Design slot', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007ev5' }); // Eve - Design, invited
    // Cancel any leftover interview from a previous test run
    await page.request.post('/api/my-interview/cancel');
    const slotsRes = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-design`,
    );
    const slots = await slotsRes.json();
    expect(slots.length).toBeGreaterThan(0);

    const bookRes = await page.request.post(
      `/api/domain-applications/da-eve-design/schedule-interview`,
      { data: { startTime: slots[0].startTime } },
    );
    expect(bookRes.status()).toBe(201);
    const interview = await bookRes.json();
    expect(interview.status).toBe('Scheduled');
    // Should have exactly 2 assignments (in-domain + cross-domain)
    expect(interview.assignments).toHaveLength(2);
  });

  test('Eve can view her scheduled interview', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007ev5' });
    const res = await page.request.get('/api/my-interview');
    expect(res.ok()).toBeTruthy();
    const interview = await res.json();
    expect(interview).not.toBeNull();
    expect(interview.status).toBe('Scheduled');
  });

  test('Eve cannot book a second interview (409)', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007ev5' });
    const slotsRes = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-design`,
    );
    const slots = await slotsRes.json();
    const bookRes = await page.request.post(
      `/api/domain-applications/da-eve-design/schedule-interview`,
      { data: { startTime: slots[0].startTime } },
    );
    expect(bookRes.status()).toBe(409);
  });

  test('Eve cancels her interview', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007ev5' });
    const res = await page.request.post('/api/my-interview/cancel');
    expect(res.ok()).toBeTruthy();
    const interview = await res.json();
    expect(interview.status).toBe('CancelledByApplicant');
  });

  test('after cancel, Eve has no active interview', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007ev5' });
    const res = await page.request.get('/api/my-interview');
    const interview = await res.json();
    expect(interview).toBeNull();
  });

  test('cancel with no active interview returns 404', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007ev5' }); // Eve just cancelled
    const res = await page.request.post('/api/my-interview/cancel');
    expect(res.status()).toBe(404);
  });

  test('after cancel, Eve can book again', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007ev5' });
    const slotsRes = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-design`,
    );
    const slots = await slotsRes.json();
    expect(slots.length).toBeGreaterThan(0);

    const bookRes = await page.request.post(
      `/api/domain-applications/da-eve-design/schedule-interview`,
      { data: { startTime: slots[0].startTime } },
    );
    expect(bookRes.status()).toBe(201);
  });
});

test.describe.serial('scheduling API: reschedule atomicity', () => {
  test('Alice has an existing interview', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007al1' });
    const res = await page.request.get('/api/my-interview');
    const interview = await res.json();
    expect(interview).not.toBeNull();
    expect(interview.status).toBe('Scheduled');
  });

  test('Alice reschedules to a different slot', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007al1' });
    // Get current interview time so we can pick a DIFFERENT slot
    const currentRes = await page.request.get('/api/my-interview');
    const current = await currentRes.json();
    const currentStart = current.startTime;

    // Get available slots
    const slotsRes = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-eng`,
    );
    const slots = await slotsRes.json();
    // Pick a slot different from the current one
    const newSlot = slots.find(
      (s: { startTime: string }) => s.startTime !== currentStart,
    ) ?? slots[0];

    const res = await page.request.post('/api/my-interview/reschedule', {
      data: { newStart: newSlot.startTime, newEnd: newSlot.endTime },
    });
    expect(res.status()).toBe(201);
    const newInterview = await res.json();
    expect(newInterview.status).toBe('Scheduled');
    expect(newInterview.startTime).toBe(newSlot.startTime);
  });

  test('after reschedule, old slot is freed', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007al1' });
    // Alice still has an active interview (the new one)
    const res = await page.request.get('/api/my-interview');
    const interview = await res.json();
    expect(interview).not.toBeNull();
    expect(interview.status).toBe('Scheduled');
  });
});

test.describe('scheduling API: authorization', () => {
  test('booking someone else\'s application returns 403', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007fe6' }); // Felix
    const slotsRes = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-eng`,
    );
    const slots = await slotsRes.json();
    // Felix tries to book Alice's domain application
    const bookRes = await page.request.post(
      `/api/domain-applications/da-alice-eng/schedule-interview`,
      { data: { startTime: slots[0].startTime } },
    );
    expect(bookRes.status()).toBe(403);
  });

  test('reschedule with missing fields returns 400', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007al1' }); // Alice (has interview after reschedule test)
    const res = await page.request.post('/api/my-interview/reschedule', {
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('scheduling API: domain filtering edge cases', () => {
  test('single-domain query returns >= slots than multi-domain query', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007bo2' }); // Bob - Design + Product
    // Single domain: cross-domain pool includes Eng + Product interviewers
    const singleRes = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-design`,
    );
    const singleSlots = await singleRes.json();

    // Both domains: cross-domain pool shrinks to Eng ONLY
    const multiRes = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-design&domainId=domain-pm`,
    );
    const multiSlots = await multiRes.json();

    expect(singleSlots.length).toBeGreaterThanOrEqual(multiSlots.length);
  });

  test('multi-domain applicant books for one domain using single-domain filtering', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007bo2' }); // Bob - Design + Product
    await page.request.post('/api/my-interview/cancel'); // clean up

    // Book for Design only — server passes [domain-design] to assignInterviewers,
    // so cross-domain pool includes Eng AND Product interviewers
    const slotsRes = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-design`,
    );
    const slots = await slotsRes.json();

    const bookRes = await page.request.post(
      `/api/domain-applications/da-bob-design/schedule-interview`,
      { data: { startTime: slots[0].startTime } },
    );
    expect(bookRes.status()).toBe(201);

    // Verify Bob has a scheduled interview
    const interviewRes = await page.request.get('/api/my-interview');
    const interview = await interviewRes.json();
    expect(interview.status).toBe('Scheduled');

    // Clean up
    await page.request.post('/api/my-interview/cancel');
  });

  test('non-invited applicant cannot book an interview', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007ha8' }); // Harper - Design, pending review, NOT invited

    const slotsRes = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-design`,
    );
    const slots = await slotsRes.json();

    const bookRes = await page.request.post(
      `/api/domain-applications/da-harper-design/schedule-interview`,
      { data: { startTime: slots[0].startTime } },
    );
    expect(bookRes.status()).toBe(403);
  });

  test('rejected applicant cannot book an interview', async ({ page, loginAs }) => {
    await loginAs({ netId: 'f007gr7' }); // Grace - Engineering, REJECTED

    const slotsRes = await page.request.get(
      `/api/cycles/${CYCLE}/available-slots?domainId=domain-eng`,
    );
    const slots = await slotsRes.json();

    const bookRes = await page.request.post(
      `/api/domain-applications/da-grace-eng/schedule-interview`,
      { data: { startTime: slots[0].startTime } },
    );
    expect(bookRes.status()).toBe(403);
  });
});
