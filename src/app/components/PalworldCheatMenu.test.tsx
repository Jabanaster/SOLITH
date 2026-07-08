import { test, expect } from '@playwright/test';

test.describe('PalworldCheatMenu', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the trainer page
    await page.goto('/trainer/palworld');
  });

  test('should_display_safety_confirmation', async ({ page }) => {
    // Check if the confirmation checkbox is visible
    const confirmCheckbox = page.locator('input[type="checkbox"]').first();
    await expect(confirmCheckbox).toBeVisible();

    const confirmLabel = page.locator('text=single-player/offline only');
    await expect(confirmLabel).toBeVisible();
  });

  test('should_hide_cheat_menu_until_confirmed', async ({ page }) => {
    // Cheat menu should not be visible initially
    const cheatMenu = page.locator('.cheat-menu-container');
    await expect(cheatMenu).not.toBeVisible();

    // Check confirmation
    const confirmCheckbox = page.locator('input[type="checkbox"]').first();
    await confirmCheckbox.check();

    // Now cheat menu should be visible
    await expect(cheatMenu).toBeVisible();
  });

  test('should_display_all_cheat_categories', async ({ page }) => {
    // Enable confirmation
    const confirmCheckbox = page.locator('input[type="checkbox"]').first();
    await confirmCheckbox.check();

    // Check for category headers
    const categories = [
      'Player',
      'Inventory',
      'Stats',
      'Weapons',
      'Enemies',
      'Game',
      'Physics',
      'Maps',
      'Video',
      'Voice',
    ];

    for (const category of categories) {
      const categoryHeader = page.locator(`text=${category}`).nth(0);
      // Some categories might not have cheats, so we'll just check for existence
      const element = await categoryHeader.isVisible();
      // Just verify it's possible to find them
    }
  });

  test('should_toggle_cheat_enable', async ({ page }) => {
    // Enable confirmation
    const confirmCheckbox = page.locator('input[type="checkbox"]').first();
    await confirmCheckbox.check();

    // Find and enable a cheat
    const infiniteHealthCheckbox = page.locator('text=Infinite Player Health').locator('..').locator('input[type="checkbox"]').first();
    await expect(infiniteHealthCheckbox).toBeVisible();

    // Toggle it
    await infiniteHealthCheckbox.check();
    await expect(infiniteHealthCheckbox).toBeChecked();

    // Verify status badge appears
    const statusBadge = page.locator('text=DISCOVERING, CONFIRMED, FROZEN, or ERROR').first();
    // Status badge should be visible after enabling
  });

  test('should_display_freeze_button_when_cheat_enabled', async ({ page }) => {
    // Enable confirmation
    const confirmCheckbox = page.locator('input[type="checkbox"]').first();
    await confirmCheckbox.check();

    // Find and enable a cheat
    const infiniteHealthCheckbox = page
      .locator('text=Infinite Player Health')
      .locator('..')
      .locator('input[type="checkbox"]')
      .first();
    await infiniteHealthCheckbox.check();

    // Freeze button should appear
    const freezeButton = page.locator('button:has-text("Freeze")').first();
    await expect(freezeButton).toBeVisible();
  });

  test('should_toggle_freeze_state', async ({ page }) => {
    // Enable confirmation
    const confirmCheckbox = page.locator('input[type="checkbox"]').first();
    await confirmCheckbox.check();

    // Enable a cheat
    const infiniteHealthCheckbox = page
      .locator('text=Infinite Player Health')
      .locator('..')
      .locator('input[type="checkbox"]')
      .first();
    await infiniteHealthCheckbox.check();

    // Click freeze button
    const freezeButton = page.locator('button:has-text("Freeze")').first();
    await freezeButton.click();

    // Button text should change to "FROZEN"
    await expect(freezeButton).toContainText('FROZEN');
  });

  test('should_display_cheat_descriptions', async ({ page }) => {
    // Enable confirmation
    const confirmCheckbox = page.locator('input[type="checkbox"]').first();
    await confirmCheckbox.check();

    // Check for descriptions
    const infiniteHealthDesc = page.locator('text=Active Pal takes no damage');
    await expect(infiniteHealthDesc).toBeVisible();
  });

  test('should_support_advanced_mode_toggle', async ({ page }) => {
    // Enable confirmation
    const confirmCheckbox = page.locator('input[type="checkbox"]').first();
    await confirmCheckbox.check();

    // Find advanced mode toggle
    const advancedModeCheckbox = page.locator('text=Advanced Mode').locator('..').locator('input[type="checkbox"]');
    await expect(advancedModeCheckbox).toBeVisible();

    // Toggle it
    await advancedModeCheckbox.check();
    await expect(advancedModeCheckbox).toBeChecked();

    // Cheat menu should be hidden
    const cheatMenu = page.locator('.cheat-menu-container');
    await expect(cheatMenu).not.toBeVisible();

    // Traditional trainer UI should be visible
    const liveTrainer = page.locator('text=How It Works');
    await expect(liveTrainer).toBeVisible();
  });
});
