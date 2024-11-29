import { describe, expect, it } from 'vitest';
import { now } from 'moment';
import { enableCEAndUnSetOrganization, enableEEAndSetOrganization } from '../../utils/testQueryHelper';
import { ADMIN_USER, GREEN_DISINFORMATION_ANALYST_GROUP, PLATFORM_ORGANIZATION, testContext } from '../../utils/testQuery';
import { addOrganization } from '../../../src/modules/organization/organization-domain';
import type { InternalRelationshipAddInput, OrganizationAddInput, ThreatActorIndividualAddInput } from '../../../src/generated/graphql';
import { addUser, assignOrganizationToUser, findById as findUserById, userAddRelation, userDelete } from '../../../src/domain/user';
import { type BasicStoreEntityOrganization } from '../../../src/modules/organization/organization-types';
import type { BasicStoreEntity } from '../../../src/types/store';
import { waitInSec } from '../../../src/database/utils';
import { addThreatActorIndividual } from '../../../src/modules/threatActorIndividual/threatActorIndividual-domain';
import { addOrganizationRestriction } from '../../../src/domain/stix';
import type { AuthUser } from '../../../src/types/user';
import { resetCacheForEntity } from '../../../src/database/cache';
import { ENTITY_TYPE_ENTITY_SETTING } from '../../../src/modules/entitySetting/entitySetting-types';

describe('Middleware test coverage on organization sharing verification', () => {
  let externalOrg: BasicStoreEntityOrganization;
  let userInPlatformOrg: AuthUser;
  let userInExternalOrg: AuthUser;

  describe('Trying to create an existing entity that is not shared to user should raise a dedicated exception.', () => {
    it('INIT - Should set platform organization and create one user in organization, one in another organization', async () => {
      await enableEEAndSetOrganization(PLATFORM_ORGANIZATION);
      const org: OrganizationAddInput = {
        name: 'ITWomen'
      };
      externalOrg = await addOrganization(testContext, ADMIN_USER, org);

      resetCacheForEntity(ENTITY_TYPE_ENTITY_SETTING);

      const userInExternalOrgInput = {
        password: 'changeme',
        user_email: 'grace.hopper@opencti.ext',
        name: 'Grace Hopper',
        firstname: 'Grace',
        lastname: 'Hopper'
      };
      const userInExternalOrgEntity = await addUser(testContext, ADMIN_USER, userInExternalOrgInput);
      await assignOrganizationToUser(testContext, ADMIN_USER, userInExternalOrgEntity.internal_id, externalOrg.id);
      const userToGroupInput: InternalRelationshipAddInput = {
        relationship_type: 'member-of',
        toId: GREEN_DISINFORMATION_ANALYST_GROUP.id
      };
      await userAddRelation(testContext, ADMIN_USER, userInExternalOrgEntity.internal_id, userToGroupInput);

      console.log('userInExternalOrgEntity => ', { userInExternalOrgEntity });

      userInExternalOrg = await findUserById(testContext, ADMIN_USER, userInExternalOrgEntity.id);
      console.log('userInExternalOrg => ', { userInExternalOrg });
      expect(userInExternalOrg.inside_platform_organization).toBeFalsy();

      const userInPlatformOrgInput = {
        password: 'changeme',
        user_email: 'alan.turing@opencti.ext',
        name: 'Alan Turing',
        firstname: 'Alan',
        lastname: 'Turing'
      };
      const userInPlatformOrgEntity = await addUser(testContext, ADMIN_USER, userInPlatformOrgInput);
      await assignOrganizationToUser(testContext, ADMIN_USER, userInPlatformOrgEntity.internal_id, PLATFORM_ORGANIZATION.id);
      await userAddRelation(testContext, ADMIN_USER, userInPlatformOrgEntity.internal_id, userToGroupInput);
      console.log('userInPlatformOrgEntity => ', { userInPlatformOrgEntity });
      userInPlatformOrg = await findUserById(testContext, ADMIN_USER, userInPlatformOrgEntity.id);
      console.log('userInPlatformOrg => ', { userInPlatformOrg });
      expect(userInPlatformOrg.inside_platform_organization).toBeTruthy();
    });

    it('Should create an entity with user in organization - WAITING', async () => {
      const threatActorIndividualName = `Testing org segregagtion ${now()}`;
      const inputOne: ThreatActorIndividualAddInput = {
        name: threatActorIndividualName,
        description: 'Created by user in org platform'
      };
      const threatActor = await addThreatActorIndividual(testContext, userInPlatformOrg, inputOne);
      await addOrganizationRestriction(testContext, ADMIN_USER, threatActor.id, PLATFORM_ORGANIZATION.id);

      const inputNext: ThreatActorIndividualAddInput = {
        name: threatActorIndividualName,
        description: 'Created by external user'
      };
      const threatActorExt = await addThreatActorIndividual(testContext, userInExternalOrg, inputNext);

      // await waitInSec(300);
    });

    it('CLEANUP - Should remove user and platform orga', async () => {
      await userDelete(testContext, ADMIN_USER, userInExternalOrg.id);
      await userDelete(testContext, ADMIN_USER, userInPlatformOrg.id);
      await enableCEAndUnSetOrganization();
    });
  });
});
