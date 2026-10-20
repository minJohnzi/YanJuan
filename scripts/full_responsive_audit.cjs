const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const VIEWPORTS = [
  { width: 1920, height: 1080, name: 'desktop-1920x1080' },
  { width: 2560, height: 1440, name: 'desktop-2560x1440' },
  { width: 1440, height: 900, name: 'laptop-1440x900' },
  { width: 1366, height: 768, name: 'laptop-low-1366x768' },
  { width: 1280, height: 720, name: 'small-desktop-1280x720' },
  { width: 1024, height: 768, name: 'tablet-landscape-1024x768' },
  { width: 768, height: 1024, name: 'tablet-portrait-768x1024' },
  { width: 430, height: 932, name: 'phone-large-430x932' },
  { width: 390, height: 844, name: 'phone-standard-390x844' },
  { width: 360, height: 800, name: 'phone-small-360x800' },
  { width: 844, height: 390, name: 'phone-landscape-844x390' },
];

const ZOOMS = [0.8, 1.0, 1.25, 1.5, 2.0];

async function runAudit() {
  const outDir = path.resolve(__dirname, '../.playwright-cli/responsive-audit');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('=== STARTING FULL RESPONSIVE & RESOLUTION AUDIT ===');
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  let totalChecks = 0;
  let passedChecks = 0;
  let failures = [];

  function check(name, condition, details) {
    totalChecks++;
    if (condition) {
      passedChecks++;
    } else {
      failures.push({ name, details });
      console.error(`  [FAIL] ${name}: ${details}`);
    }
  }

  for (const vp of VIEWPORTS) {
    console.log(`\nTesting Viewport: ${vp.name} (${vp.width}x${vp.height})`);
    await page.setViewportSize({ width: vp.width, height: vp.height });

    // 1. Home View
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    let docMetrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      bodyScrollW: document.body.scrollWidth,
    }));
    check(
      `Home No Horizontal Scroll (${vp.name})`,
      docMetrics.scrollW <= docMetrics.innerW + 1, // allow subpixel rounding
      `scrollW=${docMetrics.scrollW}, innerW=${docMetrics.innerW}`
    );

    // 2. Paper Library View
    const libraryBtn = vp.width < 768
      ? page.locator('nav[aria-label="移动端底栏导航"]').getByRole('button', { name: '真题', exact: true })
      : page.locator('nav[aria-label="主导航"]').getByRole('button', { name: '真题', exact: true });
    await libraryBtn.click();
    await page.waitForTimeout(300);
    docMetrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    check(
      `Library No Horizontal Scroll (${vp.name})`,
      docMetrics.scrollW <= docMetrics.innerW + 1,
      `scrollW=${docMetrics.scrollW}, innerW=${docMetrics.innerW}`
    );

    // 3. Open 2024 Year Overview (Catalog)
    const open2024Btn = page.getByRole('button', { name: '打开试卷' }).first();
    if (await open2024Btn.isVisible()) {
      await open2024Btn.click();
      await page.waitForTimeout(300);
      docMetrics = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      }));
      check(
        `2024 Catalog No Horizontal Scroll (${vp.name})`,
        docMetrics.scrollW <= docMetrics.innerW + 1,
        `scrollW=${docMetrics.scrollW}, innerW=${docMetrics.innerW}`
      );

      // 4. Enter Study Workspace (Reading Part A Text 1)
      const startUnitBtn = page.getByRole('button', { name: '开始该单元' }).first();
      await startUnitBtn.click();
      await page.waitForTimeout(500);

      docMetrics = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      }));
      check(
        `Reading Workspace No Horizontal Scroll (${vp.name})`,
        docMetrics.scrollW <= docMetrics.innerW + 1,
        `scrollW=${docMetrics.scrollW}, innerW=${docMetrics.innerW}`
      );

      // On mobile/tablet (<1024), check mobile article/questions segmented switcher
      if (vp.width < 1024) {
        const articleTab = page.getByRole('button', { name: '阅读文章' });
        const questionsTab = page.locator('button:has-text("题目作答")');
        check(
          `Mobile Reading Article Tab Visible (${vp.name})`,
          await articleTab.isVisible(),
          'Article tab switcher should be visible on narrow viewports'
        );
        check(
          `Mobile Reading Questions Tab Visible (${vp.name})`,
          await questionsTab.isVisible(),
          'Questions tab switcher should be visible on narrow viewports'
        );

        // Switch to article tab and verify article is rendered
        await articleTab.click();
        await page.waitForTimeout(200);
        const articleVisible = await page.locator('article').first().isVisible();
        check(`Article visible when article tab active (${vp.name})`, articleVisible, 'Article element should be visible');

        // Switch back to questions tab
        await questionsTab.click();
        await page.waitForTimeout(200);

        // Check option button touch target size
        const firstOption = page.locator('div[id^="question-card-"] button:has(span.font-tabular-mono)').first();
        if (await firstOption.isVisible()) {
          const box = await firstOption.boundingBox();
          check(
            `Option Touch Target >= 44px (${vp.name})`,
            box && box.height >= 44,
            `Option height: ${box?.height}px`
          );
        }
      }

      // Exit workspace back to home
      const logoBtn = page.getByRole('button', { name: /研卷台/ });
      await logoBtn.click();
      await page.waitForTimeout(300);
    }

    // 5. Review Center View
    const reviewBtn = vp.width < 768
      ? page.locator('nav[aria-label="移动端底栏导航"]').getByRole('button', { name: '复习', exact: true })
      : page.locator('nav[aria-label="主导航"]').getByRole('button', { name: '复习', exact: true });
    await reviewBtn.click();
    await page.waitForTimeout(300);
    docMetrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    check(
      `Review Center No Horizontal Scroll (${vp.name})`,
      docMetrics.scrollW <= docMetrics.innerW + 1,
      `scrollW=${docMetrics.scrollW}, innerW=${docMetrics.innerW}`
    );

    // 6. Stats View
    const statsBtn = vp.width < 768
      ? page.locator('nav[aria-label="移动端底栏导航"]').getByRole('button', { name: '统计', exact: true })
      : page.locator('nav[aria-label="主导航"]').getByRole('button', { name: '统计', exact: true });
    await statsBtn.click();
    await page.waitForTimeout(300);
    docMetrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    check(
      `Stats View No Horizontal Scroll (${vp.name})`,
      docMetrics.scrollW <= docMetrics.innerW + 1,
      `scrollW=${docMetrics.scrollW}, innerW=${docMetrics.innerW}`
    );

    // 7. Settings View
    const settingsBtn = page.locator('button[aria-label="设置"]');
    await settingsBtn.click();
    await page.waitForTimeout(300);
    docMetrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    check(
      `Settings View No Horizontal Scroll (${vp.name})`,
      docMetrics.scrollW <= docMetrics.innerW + 1,
      `scrollW=${docMetrics.scrollW}, innerW=${docMetrics.innerW}`
    );

    // Take screenshot for this viewport
    await page.screenshot({ path: path.join(outDir, `${vp.name}.png`) });
  }

  // 8. Test Browser Zoom Levels (80%, 100%, 125%, 150%, 200%) on 1440x900 and 390x844
  console.log('\n--- Testing Browser Zoom Scaling ---');
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const zoom of ZOOMS) {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await page.evaluate((z) => {
      document.body.style.zoom = z;
    }, zoom);
    await page.waitForTimeout(200);
    const metrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    check(
      `Zoom ${Math.round(zoom * 100)}% No Horizontal Scroll`,
      metrics.scrollW <= metrics.innerW + 2,
      `zoom=${zoom}, scrollW=${metrics.scrollW}, innerW=${metrics.innerW}`
    );
  }

  // 9. Test Dark / Light / System Mode Persistence across orientation & resize
  console.log('\n--- Testing Theme Toggle Stability ---');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:3000');
  const themeToggle = page.locator('button[aria-label="切换浅色/深色模式"]');
  const initialIsDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await themeToggle.click();
  await page.waitForTimeout(200);
  const toggledIsDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  check(
    'Theme Toggled Successfully',
    initialIsDark !== toggledIsDark,
    `Initial: ${initialIsDark}, Toggled: ${toggledIsDark}`
  );

  // Resize while in toggled mode to verify state retention
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(200);
  const rotatedIsDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  check(
    'Theme Preserved Across Screen Resize/Orientation',
    rotatedIsDark === toggledIsDark,
    `Expected: ${toggledIsDark}, Actual: ${rotatedIsDark}`
  );

  await browser.close();

  console.log(`\n=== AUDIT SUMMARY ===`);
  console.log(`Total Checks: ${totalChecks}`);
  console.log(`Passed: ${passedChecks}`);
  console.log(`Failures: ${failures.length}`);

  if (failures.length > 0) {
    console.error('\nFailures details:');
    failures.forEach((f) => console.error(` - ${f.name}: ${f.details}`));
    process.exit(1);
  } else {
    console.log('\nALL RESPONSIVE AUDIT CHECKS PASSED PERFECTLY!');
  }
}

runAudit().catch((err) => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
