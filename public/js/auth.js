function showAuthTab(tab){
    document.getElementById('loginBox').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerBox').classList.toggle('hidden', tab !== 'register');
    document.getElementById('loginTab').classList.toggle('active', tab === 'login');
    document.getElementById('registerTab').classList.toggle('active', tab === 'register');
}

async function register(event){
    event.preventDefault();
    try{
        const data = await api('/api/register', {
            method:'POST',
            body:JSON.stringify({
                studentId:document.getElementById('registerStudentId').value,
                password:document.getElementById('registerPassword').value
            })
        });
        setStatus('authStatus', data.message);
        showAuthTab('login');
        document.getElementById('loginId').value =
            document.getElementById('registerStudentId').value.toUpperCase();
    }
    catch(error){
        setStatus('authStatus', error.message, true);
    }
}

async function login(event){
    event.preventDefault();
    try{
        const data = await api('/api/login', {
            method:'POST',
            body:JSON.stringify({
                loginId:document.getElementById('loginId').value,
                password:document.getElementById('loginPassword').value
            })
        });

        authToken = data.token;
        currentUser = {userId:data.userId, role:data.role};
        localStorage.setItem('ctuMapToken', authToken);
        localStorage.setItem('ctuMapUser', JSON.stringify(currentUser));
        location.href = data.role === 'admin' ? 'teachers.html' : 'schedule.html';
    }
    catch(error){
        setStatus('authStatus', error.message, true);
    }
}

async function ctuLogin(){
    try{
        await api('/api/ctu-login', {
            method:'POST',
            body:JSON.stringify({
                studentId:document.getElementById('loginId').value
            })
        });
    }
    catch(error){
        setStatus('authStatus', error.message, true);
    }
}

window.ctuReady.then(() => {
    if(currentUser){
        setStatus('authStatus', `Bạn đang đăng nhập bằng tài khoản ${currentUser.userId}.`);
    }
});

fetch('/api/demo-credentials')
    .then(response => response.json())
    .then(credentials => {
        document.getElementById('demoAdminUsername').textContent =
            credentials.username;
        document.getElementById('demoAdminPassword').textContent =
            credentials.password;
    })
    .catch(() => {
        // Keep the tester defaults if the server is temporarily unavailable.
    });
