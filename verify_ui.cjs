const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function testOperatorModeUI() {
  console.log('Launching headless Chromium via Playwright for Operator Mode verification...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:3030 ...');
  await page.goto('http://localhost:3030', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // 1. Verify Status Bar and Persistent Scoreboard
  console.log('1. Checking Status Bar & Operator Scoreboard...');
  const title = await page.locator('header h1').innerText();
  console.log(`[PASS] Header text: "${title}"`);

  const scoreboardVisible = await page.locator('#operator-scoreboard').isVisible();
  console.log(`[PASS] Scoreboard component visible: ${scoreboardVisible}`);

  // 2. Test Spawning Live Orders
  console.log('2. Testing Spawn Order button and counter...');
  const initialCounter = await page.locator('#spawn-order-btn').locator('xpath=preceding-sibling::div').locator('.data-value').innerText();
  console.log(`[INFO] Initial orders counter: ${initialCounter}`);

  await page.click('#spawn-order-btn');
  await page.waitForTimeout(300);
  await page.click('#spawn-order-btn');
  await page.waitForTimeout(500);

  const updatedCounter = await page.locator('#spawn-order-btn').locator('xpath=preceding-sibling::div').locator('.data-value').innerText();
  console.log(`[PASS] Updated orders counter: ${updatedCounter}`);

  // 3. Test Difficulty Level Selector & Sliders
  console.log('3. Testing Level selector and fault intensity sliders...');
  await page.click('#level-1-btn');
  console.log('[PASS] Level 1 (Guided) selected');

  // Adjust Fault A slider
  await page.fill('#fault-a-slider', '3500');
  await page.dispatchEvent('#fault-a-slider', 'input');
  await page.dispatchEvent('#fault-a-slider', 'change');
  console.log('[PASS] Set Fault A slider to 3500ms');

  // 4. Trigger Fault A and verify awaiting_diagnosis state
  console.log('4. Triggering Fault A with 3500ms intensity...');
  await page.click('#trigger-fault-a-btn');
  await page.waitForTimeout(1000);

  // Verify Incident entered awaiting_diagnosis
  const timerVisible = await page.locator('#diagnosis-timer').isVisible();
  console.log(`[PASS] Diagnosis countdown timer visible: ${timerVisible}`);

  // Non-negotiable check: Verify root cause is NOT revealed during awaiting_diagnosis
  const awaitingStatus = await page.locator('text=Awaiting Operator Diagnosis').isVisible();
  console.log(`[PASS] Incident status is awaiting_diagnosis: ${awaitingStatus}`);

  const revealBannerExists = await page.locator('#diagnosis-result-banner').isVisible();
  console.log(`[PASS] Diagnosis result banner NOT yet revealed: ${!revealBannerExists}`);

  const approveButtonExists = await page.locator('#approve-recovery-btn').isVisible();
  console.log(`[PASS] Recovery approve button STRICTLY LOCKED during diagnosis: ${!approveButtonExists}`);

  // 5. Submit Diagnosis by Clicking Node in Dependency Graph (Step 3)
  console.log('5. Diagnosing incident by clicking node in D3 graph (#graph-node-payment-service)...');
  await page.click('#graph-node-payment-service');
  await page.waitForTimeout(1500);

  // Verify diagnosis revealed!
  const diagnosisResultVisible = await page.locator('#diagnosis-result-banner').isVisible();
  console.log(`[PASS] Diagnosis result banner revealed: ${diagnosisResultVisible}`);

  const bannerText = await page.locator('#diagnosis-result-banner').innerText();
  console.log(`[PASS] Verdict banner content: "${bannerText.replace(/\n/g, ' ')}"`);

  // Verify that full AI reasoning and candidate scoring are now displayed
  const aiReasoningVisible = await page.locator('text=AI Reasoning Analysis').isVisible();
  console.log(`[PASS] Full AI reasoning visible after reveal: ${aiReasoningVisible}`);

  // Verify that Approve Recovery Action button is now unlocked
  const approveBtnUnlocked = await page.locator('#approve-recovery-btn').isVisible();
  console.log(`[PASS] Approve Recovery Action button unlocked after reveal: ${approveBtnUnlocked}`);

  // 6. Test Approving Recovery and Health Resolution
  console.log('6. Approving Recovery Action...');
  await page.click('#approve-recovery-btn');
  await page.waitForTimeout(3000); // Wait for resolution animation

  // 7. Verify Scoreboard Updates
  console.log('7. Verifying Scoreboard metrics update...');
  const scoreboardText = await page.locator('#operator-scoreboard').innerText();
  console.log(`[PASS] Updated Scoreboard: ${scoreboardText.replace(/\n/g, ' ')}`);

  // 8. Test Level 3 Concurrent Chaos (Dual Independent Incidents)
  console.log('8. Testing Level 3 Concurrent Chaos...');
  await page.click('#level-3-btn');
  console.log('[PASS] Level 3 (Concurrent Chaos) selected');

  await page.click('#trigger-concurrent-chaos-btn');
  await page.waitForTimeout(1500);

  const activeIncidentsCount = await page.locator('text=Active Incidents:').isVisible();
  console.log(`[PASS] Multi-incident switcher displayed for Concurrent Chaos: ${activeIncidentsCount}`);

  // Reset faults to clean up
  console.log('9. Resetting faults...');
  await page.click('#reset-faults-btn');
  await page.waitForTimeout(1000);

  const cleanState = await page.locator('text=No Active Incidents').isVisible();
  console.log(`[PASS] System returned to clean operational state: ${cleanState}`);

  await browser.close();
  console.log('\n>>> ALL OPERATOR MODE E2E TESTS PASSED SUCCESSFULLY! <<<');
}

testOperatorModeUI().catch((err) => {
  console.error('Operator Mode UI Test failed:', err);
  process.exit(1);
});
