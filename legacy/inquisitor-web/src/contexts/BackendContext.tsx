import { Section } from 'components/CharacterBuilder/Section';
import {
    createContext,
    FunctionComponent,
    ReactNode,
    useRef,
    useState,
} from 'react';

export type BackendContextType = {
    buttons: {
        LoginButton: ReactNode;
        SignUpButton: ReactNode;
    };
};

const Modal: FunctionComponent<{
    children: ReactNode;
    title: string;
    close: () => void;
}> = ({ children, close, title }) => (
    <>
        <div className="modal-obscure" onClick={close} />
        <Section
            title={title}
            type="narrow"
            classes="modal"
            rightOfTitle={
                <button className="close-button" onClick={close}>
                    ✕
                </button>
            }
        >
            {children && children}
        </Section>
    </>
);

const AuthModal: FunctionComponent<{
    close: () => void;
    action: (email: string, password: string) => Promise<void>;
    actionText: string;
    title: string;
}> = ({ close, action, actionText, title }) => {
    const email = useRef<HTMLInputElement | null>(null);
    const password = useRef<HTMLInputElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    return (
        <Modal close={close} title={title}>
            <div className="auth-field-wrapper">
                <span className="auth-field">
                    <label htmlFor="login-email">Email: </label>
                    <input type="email" id="login-email" ref={email}></input>
                </span>
                <span className="auth-field">
                    <label htmlFor="login-email">Password: </label>
                    <input
                        type="password"
                        id="login-password"
                        ref={password}
                    ></input>
                </span>
            </div>
            <div className="error">{error && error}</div>
            <button
                onClick={async () => {
                    if (!email.current?.value) {
                        setError('Please choose an email address');
                        return;
                    }
                    if (!password.current?.value) {
                        setError('Please choose a password');
                        return;
                    }
                    try {
                        action(email.current?.value, password.current?.value);
                        setError(null);
                        close();
                    } catch (err) {
                        setError(err as string);
                    }
                }}
            >
                {actionText}
            </button>
        </Modal>
    );
};

const AuthModalButton: FunctionComponent<{
    showModal: () => void;
    text: string;
}> = ({ showModal, text }) => (
    <button type="button" onClick={showModal}>
        {text}
    </button>
);

export const BackendContext = createContext<BackendContextType | undefined>(
    undefined
);
const { Provider } = BackendContext;

export const BackendProvider: FunctionComponent<{ children: ReactNode }> = ({
    children,
}) => {
    const [loginModalVisible, setLoginModalVisible] = useState(false);
    const [createAccountModalVisible, setCreateAccountModalVisible] =
        useState(false);
    const [changePasswordModalVisible, setChangePasswordModalVisible] =
        useState(false);
    const closeAllModals = () => {
        setLoginModalVisible(false);
        setCreateAccountModalVisible(false);
        setChangePasswordModalVisible(false);
    };
    const showLoginModal = () => {
        closeAllModals();
        setLoginModalVisible(true);
    };
    const showSignUpModal = () => {
        closeAllModals();
        setCreateAccountModalVisible(true);
    };

    const value = {
        buttons: {
            LoginButton: (
                <AuthModalButton showModal={showLoginModal} text="Login" />
            ),
            SignUpButton: (
                <AuthModalButton showModal={showSignUpModal} text="Sign Up" />
            ),
        },
    };

    const login = async (email: string, password: string): Promise<void> => {
        return;
    };

    const signUp = async (email: string, password: string): Promise<void> => {
        return;
    };

    return (
        <Provider value={value}>
            {loginModalVisible && (
                <AuthModal
                    close={() => setLoginModalVisible(false)}
                    action={login}
                    actionText="Login"
                    title="Login"
                />
            )}
            {createAccountModalVisible && (
                <AuthModal
                    close={() => setCreateAccountModalVisible(false)}
                    action={signUp}
                    actionText="Sign Up"
                    title="Sign Up"
                />
            )}
            {children && children}
        </Provider>
    );
};
