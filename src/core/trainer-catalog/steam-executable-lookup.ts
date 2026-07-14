/**
 * Known Steam AppID → primary Windows executable mappings.
 * Shared by catalog seed generation and install discovery.
 */
export const STEAM_EXECUTABLE_LOOKUP = new Map<number, string[]>([
  [413150, ['Stardew Valley.exe']],
  [105600, ['Terraria.exe']],
  [1623730, ['Palworld-Win64-Shipping.exe']],
  [1086940, ['bg3.exe', 'bg3_dx11.exe']],
  [1091500, ['Cyberpunk2077.exe']],
  [1245620, ['eldenring.exe']],
  [367520, ['Hollow Knight.exe']],
  [264710, ['Subnautica.exe']],
  [427520, ['factorio.exe']],
  [108600, ['ProjectZomboid64.exe']],
  [2457220, ['Avowed.exe']],
  [801800, ['Atomfall.exe', 'Atomfall_dx12.exe']],
  [1562430, ['Dredge.exe']],
  [3321460, ['CrimsonDesert.exe']],
  [1778820, ['Polaris-Win64-Shipping.exe']],
  [1364780, ['StreetFighter6.exe']],
  [1971870, ['MK12.exe']],
  [489830, ['SkyrimSE.exe']],
  [1174180, ['RDR2.exe']],
  [271590, ['GTA5.exe']],
  [892970, ['valheim.exe']],
  [526870, ['FactoryGame-Win64-Shipping.exe']],
  [1145360, ['Hades.exe']],
  [588650, ['deadcells.exe']],
  [620, ['hl2.exe']],
  [730, ['cs2.exe']],
]);

export function executablesForSteamAppId(steamAppId: number): string[] | null {
  return STEAM_EXECUTABLE_LOOKUP.get(steamAppId) ?? null;
}
