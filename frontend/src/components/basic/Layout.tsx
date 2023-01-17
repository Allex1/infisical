/* eslint-disable no-nested-ternary */
/* eslint-disable no-unexpected-multiline */
/* eslint-disable react-hooks/exhaustive-deps */
import crypto from 'crypto';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import {
  faBookOpen,
  faFileLines,
  faGear,
  faKey,
  faMobile,
  faPlug,
  faPlus,
  faUser
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import getOrganizations from '@app/pages/api/organization/getOrgs';
import getOrganizationUserProjects from '@app/pages/api/organization/GetOrgUserProjects';
import getOrganizationUsers from '@app/pages/api/organization/GetOrgUsers';
import getUser from '@app/pages/api/user/getUser';
import addUserToWorkspace from '@app/pages/api/workspace/addUserToWorkspace';
import createWorkspace from '@app/pages/api/workspace/createWorkspace';
import getWorkspaces from '@app/pages/api/workspace/getWorkspaces';
import uploadKeys from '@app/pages/api/workspace/uploadKeys';

import NavBarDashboard from '../navigation/NavBarDashboard';
import onboardingCheck from '../utilities/checks/OnboardingCheck';
import { tempLocalStorage } from '../utilities/checks/tempLocalStorage';
import { decryptAssymmetric, encryptAssymmetric } from '../utilities/cryptography/crypto';
import Button from './buttons/Button';
import AddWorkspaceDialog from './dialog/AddWorkspaceDialog';
import Listbox from './Listbox';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const [workspaceMapping, setWorkspaceMapping] = useState<Map<string, string>[]>([]);
  const [workspaceSelected, setWorkspaceSelected] = useState('∞');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [totalOnboardingActionsDone, setTotalOnboardingActionsDone] = useState(0);

  const { t } = useTranslation();

  const closeModal = () => {
    setIsOpen(false);
  };

  const openModal = () => {
    setIsOpen(true);
  };

  // TODO: what to do about the fact that 2ids can have the same name

  /**
   * When a user creates a new workspace, redirect them to the page of the new workspace.
   * @param {*} workspaceName
   */
  const submitModal = async (workspaceName: string, addAllUsers: boolean) => {
    setLoading(true);
    // timeout code.
    setTimeout(() => setLoading(false), 1500);

    try {
      const workspaces = await getWorkspaces();
      const currentWorkspaces = workspaces.map((workspace) => workspace.name);
      if (!currentWorkspaces.includes(workspaceName)) {
        const newWorkspace = await createWorkspace({
          workspaceName,
          organizationId: tempLocalStorage('orgData.id')
        });
        const newWorkspaceId = newWorkspace._id;

        const randomBytes = crypto.randomBytes(16).toString('hex');
        const PRIVATE_KEY = String(localStorage.getItem('PRIVATE_KEY'));

        const myUser = await getUser();

        const { ciphertext, nonce } = encryptAssymmetric({
          plaintext: randomBytes,
          publicKey: myUser.publicKey,
          privateKey: PRIVATE_KEY
        });

        await uploadKeys(newWorkspaceId, myUser._id, ciphertext, nonce);

        if (addAllUsers) {
          console.log('adding other users');
          const orgUsers = await getOrganizationUsers({
            orgId: tempLocalStorage('orgData.id')
          });
          orgUsers.map(async (user: any) => {
            if (user.status === 'accepted' && user.email !== myUser.email) {
              const result = await addUserToWorkspace(user.user.email, newWorkspaceId);
              if (result?.invitee && result?.latestKey) {
                const TEMP_PRIVATE_KEY = tempLocalStorage('PRIVATE_KEY');

                // assymmetrically decrypt symmetric key with local private key
                const key = decryptAssymmetric({
                  ciphertext: result.latestKey.encryptedKey,
                  nonce: result.latestKey.nonce,
                  publicKey: result.latestKey.sender.publicKey,
                  privateKey: TEMP_PRIVATE_KEY
                });

                const { ciphertext: inviteeCipherText, nonce: inviteeNonce } = encryptAssymmetric({
                  plaintext: key,
                  publicKey: result.invitee.publicKey,
                  privateKey: PRIVATE_KEY
                });

                uploadKeys(newWorkspaceId, result.invitee._id, inviteeCipherText, inviteeNonce);
              }
            }
          });
        }
        setWorkspaceMapping((prevState) => ({
          ...prevState,
          [workspaceName]: newWorkspaceId
        }));
        setWorkspaceSelected(workspaceName);
        setIsOpen(false);
        setNewWorkspaceName('');
      } else {
        console.error('A project with this name already exists.');
        setError(true);
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setError(true);
      setLoading(false);
    }
  };

  const menuItems = useMemo(
    () => [
      {
        href: `/dashboard/${workspaceMapping[workspaceSelected as any]}`,
        title: t('nav:menu.secrets'),
        emoji: <FontAwesomeIcon icon={faKey} />
      },
      {
        href: `/users/${workspaceMapping[workspaceSelected as any]}`,
        title: t('nav:menu.members'),
        emoji: <FontAwesomeIcon icon={faUser} />
      },
      {
        href: `/integrations/${workspaceMapping[workspaceSelected as any]}`,
        title: t('nav:menu.integrations'),
        emoji: <FontAwesomeIcon icon={faPlug} />
      },
      {
        href: `/activity/${workspaceMapping[workspaceSelected as any]}`,
        title: 'Activity Logs',
        emoji: <FontAwesomeIcon icon={faFileLines} />
      },
      {
        href: `/settings/project/${workspaceMapping[workspaceSelected as any]}`,
        title: t('nav:menu.project-settings'),
        emoji: <FontAwesomeIcon icon={faGear} />
      }
    ],
    [t, workspaceMapping, workspaceSelected]
  );

  useEffect(() => {
    // Put a user in a workspace if they're not in one yet
    const putUserInWorkSpace = async () => {
      if (tempLocalStorage('orgData.id') === '') {
        const userOrgs = await getOrganizations();
        localStorage.setItem('orgData.id', userOrgs[0]._id);
      }

      const orgUserProjects = await getOrganizationUserProjects({
        orgId: tempLocalStorage('orgData.id')
      });
      const userWorkspaces = orgUserProjects;
      if (
        userWorkspaces.length === 0 &&
        router.asPath !== '/noprojects' &&
        !router.asPath.includes('home') &&
        !router.asPath.includes('settings')
      ) {
        router.push('/noprojects');
      } else if (router.asPath !== '/noprojects') {
        const intendedWorkspaceId = router.asPath
          .split('/')
          [router.asPath.split('/').length - 1].split('?')[0];

        if (!['heroku', 'vercel', 'github', 'netlify'].includes(intendedWorkspaceId)) {
          localStorage.setItem('projectData.id', intendedWorkspaceId);
        }

        // If a user is not a member of a workspace they are trying to access, just push them to one of theirs
        if (
          !['heroku', 'vercel', 'github', 'netlify'].includes(intendedWorkspaceId) &&
          !userWorkspaces
            .map((workspace: { _id: string }) => workspace._id)
            .includes(intendedWorkspaceId)
        ) {
          router.push(`/dashboard/${userWorkspaces[0]._id}`);
        } else {
          setWorkspaceMapping(
            Object.fromEntries(
              userWorkspaces.map((workspace: any) => [workspace.name, workspace._id])
            ) as any
          );
          setWorkspaceSelected(
            Object.fromEntries(
              userWorkspaces.map((workspace: any) => [workspace._id, workspace.name])
            )[router.asPath.split('/')[router.asPath.split('/').length - 1].split('?')[0]]
          );
        }
      }
    };
    putUserInWorkSpace();
    onboardingCheck({ setTotalOnboardingActionsDone });
  }, [router.query.id]);

  useEffect(() => {
    try {
      if (
        workspaceMapping[workspaceSelected as any] &&
        `${workspaceMapping[workspaceSelected as any]}` !==
          router.asPath.split('/')[router.asPath.split('/').length - 1].split('?')[0]
      ) {
        localStorage.setItem('projectData.id', `${workspaceMapping[workspaceSelected as any]}`);
        router.push(`/dashboard/${workspaceMapping[workspaceSelected as any]}`);
      }
    } catch (err) {
      console.log(err);
    }
  }, [workspaceSelected]);

  return (
    <>
      <div className="fixed w-full md:block flex flex-col h-screen">
        <script src="https://cdnjs.cloudflare.com/ajax/libs/alpinejs/3.2.2/cdn.js" defer />
        <NavBarDashboard />
        <div className="flex flex-col md:flex-row flex-1">
          <aside className="bg-bunker-600 border-r border-mineshaft-500 w-full md:w-60 h-screen">
            <nav className="flex flex-col justify-between items-between h-full">
              {/* <div className="py-6"></div> */}
              <div>
                <div className="flex justify-center w-full mt-[4.5rem] mb-6 bg-bunker-600 h-20 flex-col items-center px-4">
                  <div className="text-gray-400 self-start ml-1 mb-1 text-xs font-semibold tracking-wide">
                    {t('nav:menu.project')}
                  </div>
                  {Object.keys(workspaceMapping).length > 0 ? (
                    <Listbox
                      selected={workspaceSelected}
                      onChange={setWorkspaceSelected}
                      data={Object.keys(workspaceMapping)}
                      buttonAction={openModal}
                      text=""
                    />
                  ) : (
                    <Button
                      text="Add Project"
                      onButtonPressed={openModal}
                      color="mineshaft"
                      size="md"
                      icon={faPlus}
                    />
                  )}
                </div>
                <ul>
                  {Object.keys(workspaceMapping).length > 0 &&
                    menuItems.map(({ href, title, emoji }) => (
                      <li className="mt-0.5 mx-2" key={title}>
                        {router.asPath.split('/')[1] === href.split('/')[1] &&
                        (['project', 'billing', 'org', 'personal'].includes(
                          router.asPath.split('/')[2]
                        )
                          ? router.asPath.split('/')[2] === href.split('/')[2]
                          : true) ? (
                          <div className="flex relative px-0.5 py-2.5 text-white text-sm rounded cursor-pointer bg-primary-50/10">
                            <div className="absolute top-0 my-1 ml-1 inset-0 bg-primary w-1 rounded-xl mr-1" />
                            <p className="w-6 ml-4 mr-2 flex items-center justify-center text-lg">
                              {emoji}
                            </p>
                            {title}
                          </div>
                        ) : router.asPath === '/noprojects' ? (
                          <div className="flex p-2.5 text-white text-sm rounded">
                            <p className="w-10 flex items-center justify-center text-lg">{emoji}</p>
                            {title}
                          </div>
                        ) : (
                          <Link href={href}>
                            <div className="flex p-2.5 text-white text-sm rounded cursor-pointer hover:bg-primary-50/5">
                              <p className="w-10 flex items-center justify-center text-lg">
                                {emoji}
                              </p>
                              {title}
                            </div>
                          </Link>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
              <div className="w-full mt-40 mb-4 px-2">
                {router.asPath.split('/')[1] === 'home' ? (
                  <div className="flex relative px-0.5 py-2.5 text-white text-sm rounded cursor-pointer bg-primary-50/10">
                    <div className="absolute top-0 my-1 ml-1 inset-0 bg-primary w-1 rounded-xl mr-1" />
                    <p className="w-6 ml-4 mr-2 flex items-center justify-center text-lg">
                      <FontAwesomeIcon icon={faBookOpen} />
                    </p>
                    Infisical Guide
                    <img
                      src={`/images/progress-${totalOnboardingActionsDone === 0 ? '0' : ''}${
                        totalOnboardingActionsDone === 1 ? '14' : ''
                      }${totalOnboardingActionsDone === 2 ? '28' : ''}${
                        totalOnboardingActionsDone === 3 ? '43' : ''
                      }${totalOnboardingActionsDone === 4 ? '57' : ''}${
                        totalOnboardingActionsDone === 5 ? '71' : ''
                      }.svg`}
                      height={58}
                      width={58}
                      alt="progress bar"
                      className="absolute right-2 -top-2"
                    />
                  </div>
                ) : (
                  <Link href={`/home/${workspaceMapping[workspaceSelected as any]}`}>
                    <div className="relative flex p-2.5 overflow-visible text-white h-10 text-sm rounded cursor-pointer bg-white/10 hover:bg-primary-50/[0.15] mt-max">
                      <p className="w-10 flex items-center justify-center text-lg">
                        <FontAwesomeIcon icon={faBookOpen} />
                      </p>
                      Infisical Guide
                      <img
                        src={`/images/progress-${totalOnboardingActionsDone === 0 ? '0' : ''}${
                          totalOnboardingActionsDone === 1 ? '14' : ''
                        }${totalOnboardingActionsDone === 2 ? '28' : ''}${
                          totalOnboardingActionsDone === 3 ? '43' : ''
                        }${totalOnboardingActionsDone === 4 ? '57' : ''}${
                          totalOnboardingActionsDone === 5 ? '71' : ''
                        }.svg`}
                        height={58}
                        width={58}
                        alt="progress bar"
                        className="absolute right-2 -top-2"
                      />
                    </div>
                  </Link>
                )}
              </div>
            </nav>
          </aside>
          <AddWorkspaceDialog
            isOpen={isOpen}
            closeModal={closeModal}
            submitModal={submitModal}
            workspaceName={newWorkspaceName}
            setWorkspaceName={setNewWorkspaceName}
            error={error}
            loading={loading}
          />
          <main className="flex-1 bg-bunker-800">{children}</main>
        </div>
      </div>
      <div className="md:hidden bg-bunker-800 w-screen h-screen flex flex-col justify-center items-center">
        <FontAwesomeIcon icon={faMobile} className="text-gray-300 text-7xl mb-8" />
        <p className="text-gray-200 px-6 text-center text-lg max-w-sm">
          {` ${t('common:no-mobile')} `}
        </p>
      </div>
    </>
  );
};

export default Layout;
