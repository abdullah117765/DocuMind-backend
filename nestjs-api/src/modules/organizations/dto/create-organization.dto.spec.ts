import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrganizationDto } from './create-organization.dto';

describe('CreateOrganizationDto', () => {
  it('normalizes a valid organization payload', async () => {
    const dto = plainToInstance(CreateOrganizationDto, {
      name: '  Acme   Finance  ',
      slug: ' ACME-FINANCE ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toEqual({
      name: 'Acme Finance',
      slug: 'acme-finance',
    });
  });

  it('allows the slug to be generated from the name', async () => {
    const dto = plainToInstance(CreateOrganizationDto, {
      name: 'Acme Finance',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.slug).toBeUndefined();
  });

  it('rejects unsafe names and slugs', async () => {
    const dto = plainToInstance(CreateOrganizationDto, {
      name: '<script>',
      slug: 'bad slug',
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'name',
      'slug',
    ]);
  });
});
