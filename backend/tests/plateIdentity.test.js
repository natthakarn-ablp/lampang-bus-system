'use strict';

/**
 * plateIdentity.test.js  (Phase 10.13A-25)
 *
 * PURE unit tests for the permanent plate-identity module: deterministic
 * normalization, province-alias resolution, and conflict classification.
 */

const PI = require('../src/utils/plateIdentity');

describe('plate normalization is deterministic', () => {
  test('spacing/dash variants → same canonical when province matches', () => {
    const a = PI.buildCanonicalPlate({ plate_prefix: 'นข', plate_number: '4031', province: 'ลำปาง' });
    expect(PI.comparePlateIdentity('นข4031ลำปาง', 'นข 4031 ลำปาง')).toBe(true);
    expect(PI.comparePlateIdentity('นข-4031-ลำปาง', 'นข 4031 ลำปาง')).toBe(true);
    expect(PI.buildCanonicalPlate({ plate_prefix: 'นข', plate_number: '4031', province: 'ลำปาง' })).toBe(a);
  });
  test('display plate resolves province alias', () => {
    expect(PI.buildDisplayPlate({ plate_prefix: 'ออ', plate_number: '7332', province: 'กทม' })).toBe('ออ 7332 กรุงเทพมหานคร');
    expect(PI.buildDisplayPlate({ plate_prefix: 'นข', plate_number: '4031', province: 'ลำปาง' })).toBe('นข 4031 ลำปาง');
  });
});

describe('province alias normalization', () => {
  const officialProvinceAliases = [
    ['กบ', 'KBI', 'กระบี่'],
    ['กจ', 'KRI', 'กาญจนบุรี'],
    ['กส', 'KSN', 'กาฬสินธุ์'],
    ['กพ', 'KPT', 'กำแพงเพชร'],
    ['ขก', 'KKN', 'ขอนแก่น'],
    ['จบ', 'CTI', 'จันทบุรี'],
    ['ฉช', 'CCO', 'ฉะเชิงเทรา'],
    ['ชบ', 'CBI', 'ชลบุรี'],
    ['ชน', 'CNT', 'ชัยนาท'],
    ['ชย', 'CPM', 'ชัยภูมิ'],
    ['ชพ', 'CPN', 'ชุมพร'],
    ['ชร', 'CRI', 'เชียงราย'],
    ['ชม', 'CMI', 'เชียงใหม่'],
    ['ตง', 'TRG', 'ตรัง'],
    ['ตร', 'TRT', 'ตราด'],
    ['ตก', 'TAK', 'ตาก'],
    ['นย', 'NYK', 'นครนายก'],
    ['นฐ', 'NPT', 'นครปฐม'],
    ['นพ', 'NPM', 'นครพนม'],
    ['นม', 'NMA', 'นครราชสีมา'],
    ['นศ', 'NRT', 'นครศรีธรรมราช'],
    ['นว', 'NSN', 'นครสวรรค์'],
    ['นบ', 'NBI', 'นนทบุรี'],
    ['นธ', 'NWT', 'นราธิวาส'],
    ['นน', 'NAN', 'น่าน'],
    ['บก', 'BKN', 'บึงกาฬ'],
    ['บร', 'BRM', 'บุรีรัมย์'],
    ['ปท', 'PTE', 'ปทุมธานี'],
    ['ปข', 'PKN', 'ประจวบคีรีขันธ์'],
    ['ปจ', 'PRI', 'ปราจีนบุรี'],
    ['ปน', 'PTN', 'ปัตตานี'],
    ['พย', 'PYO', 'พะเยา'],
    ['อย', 'AYA', 'พระนครศรีอยุธยา'],
    ['พง', 'PNA', 'พังงา'],
    ['พท', 'PLG', 'พัทลุง'],
    ['พจ', 'PCT', 'พิจิตร'],
    ['พล', 'PLK', 'พิษณุโลก'],
    ['พบ', 'PBI', 'เพชรบุรี'],
    ['พช', 'PNB', 'เพชรบูรณ์'],
    ['พร', 'PRE', 'แพร่'],
    ['ภก', 'PKT', 'ภูเก็ต'],
    ['มค', 'MKM', 'มหาสารคาม'],
    ['มห', 'MDH', 'มุกดาหาร'],
    ['มส', 'MSN', 'แม่ฮ่องสอน'],
    ['ยส', 'YST', 'ยโสธร'],
    ['ยล', 'YLA', 'ยะลา'],
    ['รอ', 'RET', 'ร้อยเอ็ด'],
    ['รน', 'RNG', 'ระนอง'],
    ['รย', 'RYG', 'ระยอง'],
    ['รบ', 'RBR', 'ราชบุรี'],
    ['ลบ', 'LRI', 'ลพบุรี'],
    ['ลป', 'LPG', 'ลำปาง'],
    ['ลพ', 'LPN', 'ลำพูน'],
    ['ลย', 'LEI', 'เลย'],
    ['ศก', 'SSK', 'ศรีสะเกษ'],
    ['สน', 'SNK', 'สกลนคร'],
    ['สข', 'SKA', 'สงขลา'],
    ['สต', 'STN', 'สตูล'],
    ['สป', 'SPK', 'สมุทรปราการ'],
    ['สส', 'SKM', 'สมุทรสงคราม'],
    ['สค', 'SKN', 'สมุทรสาคร'],
    ['สก', 'SKW', 'สระแก้ว'],
    ['สบ', 'SRI', 'สระบุรี'],
    ['สห', 'SBR', 'สิงห์บุรี'],
    ['สท', 'STI', 'สุโขทัย'],
    ['สพ', 'SPB', 'สุพรรณบุรี'],
    ['สฎ', 'SNI', 'สุราษฎร์ธานี'],
    ['สร', 'SRN', 'สุรินทร์'],
    ['นค', 'NKI', 'หนองคาย'],
    ['นภ', 'NBP', 'หนองบัวลำภู'],
    ['อท', 'ATG', 'อ่างทอง'],
    ['อจ', 'ACR', 'อำนาจเจริญ'],
    ['อด', 'UDN', 'อุดรธานี'],
    ['อต', 'UTT', 'อุตรดิตถ์'],
    ['อน', 'UTI', 'อุทัยธานี'],
    ['อบ', 'UBN', 'อุบลราชธานี'],
    ['กทม', 'BKK', 'กรุงเทพมหานคร'],
  ];

  test('กทม / กรุงเทพ / กรุงเทพมหานคร / Bangkok / BKK → same canonical province', () => {
    const forms = ['กทม', 'กรุงเทพ', 'กรุงเทพฯ', 'กรุงเทพมหานคร', 'Bangkok', 'BKK', ' bkk '];
    const set = new Set(forms.map((f) => PI.normalizeProvince(f)));
    expect(set.size).toBe(1);
    expect([...set][0]).toBe('กรุงเทพมหานคร');
  });
  test.each(officialProvinceAliases)('official province aliases %s / %s → %s', (thaiAbbr, romanAbbr, province) => {
    expect(PI.normalizeProvince(thaiAbbr)).toBe(province);
    expect(PI.normalizeProvince(`${thaiAbbr}.`)).toBe(province);
    expect(PI.normalizeProvince(romanAbbr)).toBe(province);
    expect(PI.normalizeProvince(`จังหวัด${province}`)).toBe(province);
    expect(PI.normalizeProvince(`จ.${province}`)).toBe(province);
  });
  test('plate identity is alias-insensitive: ออ7332กทม == ออ7332กรุงเทพมหานคร', () => {
    expect(PI.comparePlateIdentity(
      { plate_prefix: 'ออ', plate_number: '7332', province: 'กทม' },
      'ออ 7332 กรุงเทพมหานคร'
    )).toBe(true);
  });
  test('non-alias province kept as-is (ลำปาง ≠ ลำพูน)', () => {
    expect(PI.normalizeProvince('ลำปาง')).toBe('ลำปาง');
    expect(PI.comparePlateIdentity('นข4031ลำปาง', 'นข4031ลำพูน')).toBe(false);
  });

  test('Lampang abbreviation ลป. matches canonical ลำปาง', () => {
    expect(PI.normalizeProvince('ลป.')).toBe('ลำปาง');
    expect(PI.normalizeProvince('LPG')).toBe('ลำปาง');
    expect(PI.normalizeProvince('จ.ลำปาง')).toBe('ลำปาง');
    expect(PI.normalizeProvince('จังหวัดลำปาง')).toBe('ลำปาง');
    expect(PI.comparePlateIdentity('นข 8276 ลป.', 'นข 8276 ลำปาง')).toBe(true);
    expect(PI.comparePlateIdentity('นข 8276 จ.ลำปาง', 'นข 8276 ลำปาง')).toBe(true);
  });
});

describe('classifyVehiclePlateConflict (A–F codes)', () => {
  const active = (id, plate, school) => ({ id, plate_no: plate, is_deleted: 0, school_id: school });
  const deleted = (id, plate) => ({ id, plate_no: plate, is_deleted: 1 });

  test('SAME_ACTIVE_VEHICLE_SAME_SCHOOL', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'นข', plate_number: '4031', province: 'ลำปาง' },
      [active('V-1', 'นข 4031 ลำปาง', 'S1')], { schoolId: 'S1' });
    expect(r.code).toBe('SAME_ACTIVE_VEHICLE_SAME_SCHOOL');
    expect(r.vehicle_id).toBe('V-1');
  });
  test('SAME_ACTIVE_VEHICLE_OTHER_SCHOOL', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'นข', plate_number: '4031', province: 'ลำปาง' },
      [active('V-1', 'นข 4031 ลำปาง', 'S2')], { schoolId: 'S1' });
    expect(r.code).toBe('SAME_ACTIVE_VEHICLE_OTHER_SCHOOL');
  });
  test('SOFT_DELETED_VEHICLE_EXISTS', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'นข', plate_number: '4031', province: 'ลำปาง' },
      [deleted('V-d', 'นข 4031 ลำปาง')]);
    expect(r.code).toBe('SOFT_DELETED_VEHICLE_EXISTS');
    expect(r.is_deleted).toBe(true);
  });
  test('PROVINCE_ALIAS_DUPLICATE (กทม vs กรุงเทพมหานคร)', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'ออ', plate_number: '7332', province: 'กรุงเทพมหานคร' },
      [active('V-bkk', 'ออ 7332 กทม', 'S1')]);
    expect(r.code).toBe('PROVINCE_ALIAS_DUPLICATE');
    expect(r.vehicle_id).toBe('V-bkk');
  });
  test('AMBIGUOUS_PLATE_NEEDS_PROVINCE (province omitted, base collides)', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'นข', plate_number: '4031', province: '' },
      [active('V-1', 'นข 4031 ลำปาง', 'S1')]);
    expect(r.code).toBe('AMBIGUOUS_PLATE_NEEDS_PROVINCE');
  });
  test('VALID_NEW_VEHICLE', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'ผก', plate_number: '9999', province: 'ลำปาง' },
      [active('V-1', 'นข 4031 ลำปาง', 'S1')]);
    expect(r.code).toBe('VALID_NEW_VEHICLE');
  });
  test('PLATE_FORMAT_INVALID', () => {
    expect(PI.classifyVehiclePlateConflict({ plate_prefix: '', plate_number: '', province: '' }, []).code).toBe('PLATE_FORMAT_INVALID');
  });
  test('different number is not a conflict', () => {
    const r = PI.classifyVehiclePlateConflict(
      { plate_prefix: 'นข', plate_number: '4032', province: 'ลำปาง' },
      [active('V-1', 'นข 4031 ลำปาง', 'S1')]);
    expect(r.code).toBe('VALID_NEW_VEHICLE');
  });
});
