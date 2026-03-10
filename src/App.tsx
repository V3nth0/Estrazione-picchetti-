import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, getDoc, addDoc, deleteDoc, updateDoc, serverTimestamp, query, orderBy, writeBatch } from 'firebase/firestore';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { handleFirestoreError, OperationType } from './utils/firestoreErrorHandler';
import { LogIn, LogOut, Users, UserPlus, Trash2, RotateCcw, Shuffle, Settings, User as UserIcon, Users as UsersIcon } from 'lucide-react';

const SECTOR_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V'];

interface Participant {
  id: string;
  firstName: string;
  lastName: string;
  assignedNumber: number | null;
  createdAt: any;
  teamName?: string;
}

interface UserSettings {
  maxPicchetti: number;
  role: string;
  selectedSectors?: string[];
}

function MainApp({ user }: { user: User }) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [settings, setSettings] = useState<UserSettings>({ maxPicchetti: 50, role: 'user' });
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [addMode, setAddMode] = useState<'single' | 'pair' | 'team'>('single');
  const [teamName, setTeamName] = useState('');
  const [teamMembers, setTeamMembers] = useState([
    { firstName: '', lastName: '' },
    { firstName: '', lastName: '' },
    { firstName: '', lastName: '' },
    { firstName: '', lastName: '' }
  ]);
  const [pairName, setPairName] = useState('');
  const [pairMembers, setPairMembers] = useState([
    { firstName: '', lastName: '' },
    { firstName: '', lastName: '' }
  ]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [lastExtraction, setLastExtraction] = useState<{
    firstName: string;
    lastName: string;
    number: number;
    sector: string;
    position: number;
    teamName?: string;
  }[] | null>(null);

  const numSectors = Math.ceil(settings.maxPicchetti / 5);
  const availableSectors = SECTOR_LETTERS.slice(0, numSectors);
  const activeSectors = settings.selectedSectors 
    ? availableSectors.filter(s => settings.selectedSectors!.includes(s))
    : availableSectors;

  const toggleSector = async (sector: string) => {
    const currentSelected = settings.selectedSectors || availableSectors;
    let newSelected;
    if (currentSelected.includes(sector)) {
      newSelected = currentSelected.filter(s => s !== sector);
    } else {
      newSelected = [...currentSelected, sector];
    }
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        selectedSectors: newSelected
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const getSectorInfo = (num: number) => {
    const index = num - 1;
    const sectorIndex = Math.floor(index / 5);
    const position = (index % 5) + 1;
    return {
      sector: SECTOR_LETTERS[sectorIndex] || '?',
      position
    };
  };

  useEffect(() => {
    if (!user.uid) return;
    
    // Initialize user settings if not exist
    const initUser = async () => {
      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, { 
            maxPicchetti: 50, 
            role: 'user',
            selectedSectors: SECTOR_LETTERS.slice(0, 10)
          });
        }
        setIsAuthReady(true);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
      }
    };
    initUser();
  }, [user.uid]);

  useEffect(() => {
    if (!isAuthReady || !user.uid) return;

    const userRef = doc(db, 'users', user.uid);
    const unsubSettings = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        setSettings(doc.data() as UserSettings);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${user.uid}`));

    const q = query(collection(db, `users/${user.uid}/participants`), orderBy('createdAt', 'desc'));
    const unsubParticipants = onSnapshot(q, (snapshot) => {
      const parts: Participant[] = [];
      snapshot.forEach((doc) => {
        parts.push({ id: doc.id, ...doc.data() } as Participant);
      });
      setParticipants(parts);
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${user.uid}/participants`));

    return () => {
      unsubSettings();
      unsubParticipants();
    };
  }, [user.uid, isAuthReady]);

  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;
    try {
      await addDoc(collection(db, `users/${user.uid}/participants`), {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        assignedNumber: null,
        createdAt: serverTimestamp()
      });
      setFirstName('');
      setLastName('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/participants`);
    }
  };

  const handleAddPair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairName.trim()) return;
    if (pairMembers.some(m => !m.firstName.trim() || !m.lastName.trim())) return;

    try {
      const batch = writeBatch(db);
      pairMembers.forEach(m => {
        const docRef = doc(collection(db, `users/${user.uid}/participants`));
        batch.set(docRef, {
          firstName: m.firstName.trim(),
          lastName: m.lastName.trim(),
          teamName: pairName.trim(),
          assignedNumber: null,
          createdAt: serverTimestamp()
        });
      });
      await batch.commit();
      setPairName('');
      setPairMembers([
        { firstName: '', lastName: '' },
        { firstName: '', lastName: '' }
      ]);
      setAddMode('single');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/participants`);
    }
  };

  const handleAddTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim()) return;
    if (teamMembers.some(m => !m.firstName.trim() || !m.lastName.trim())) return;

    try {
      const batch = writeBatch(db);
      teamMembers.forEach(m => {
        const docRef = doc(collection(db, `users/${user.uid}/participants`));
        batch.set(docRef, {
          firstName: m.firstName.trim(),
          lastName: m.lastName.trim(),
          teamName: teamName.trim(),
          assignedNumber: null,
          createdAt: serverTimestamp()
        });
      });
      await batch.commit();
      setTeamName('');
      setTeamMembers([
        { firstName: '', lastName: '' },
        { firstName: '', lastName: '' },
        { firstName: '', lastName: '' },
        { firstName: '', lastName: '' }
      ]);
      setAddMode('single');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/participants`);
    }
  };

  const handleDeleteParticipant = async (id: string) => {
    try {
      await deleteDoc(doc(db, `users/${user.uid}/participants`, id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/participants/${id}`);
    }
  };

  const handleClearAssignment = async (id: string) => {
    try {
      await updateDoc(doc(db, `users/${user.uid}/participants`, id), {
        assignedNumber: null
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/participants/${id}`);
    }
  };

  const handleClearAllAssignments = async () => {
    if (!window.confirm('Sei sicuro di voler rimuovere tutte le assegnazioni?')) return;
    try {
      const batch = writeBatch(db);
      participants.forEach(p => {
        if (p.assignedNumber !== null) {
          const ref = doc(db, `users/${user.uid}/participants`, p.id);
          batch.update(ref, { assignedNumber: null });
        }
      });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/participants`);
    }
  };

  const handleClearAllParticipants = async () => {
    if (!window.confirm('Sei sicuro di voler eliminare TUTTI i partecipanti? Questa azione è irreversibile.')) return;
    try {
      const batch = writeBatch(db);
      participants.forEach(p => {
        const ref = doc(db, `users/${user.uid}/participants`, p.id);
        batch.delete(ref);
      });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/participants`);
    }
  };

  const handleUpdateMaxPicchetti = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 100) val = 100;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        maxPicchetti: val
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const extractRandom = async (peopleCount: number, numbersCount: number = peopleCount) => {
    const unassigned = participants.filter(p => p.assignedNumber === null && !p.teamName);
    if (unassigned.length < peopleCount) {
      alert(`Non ci sono abbastanza partecipanti singoli non assegnati. Ne servono ${peopleCount}, ma ce ne sono ${unassigned.length}.`);
      return;
    }

    const assignedNumbers = new Set(participants.map(p => p.assignedNumber).filter(n => n !== null));
    const availableNumbers: number[] = [];
    
    activeSectors.forEach(sector => {
      const sectorIndex = SECTOR_LETTERS.indexOf(sector);
      const startNum = sectorIndex * 5 + 1;
      for (let i = 0; i < 5; i++) {
        const num = startNum + i;
        if (num <= settings.maxPicchetti && !assignedNumbers.has(num)) {
          availableNumbers.push(num);
        }
      }
    });

    if (availableNumbers.length < numbersCount) {
      alert(`Non ci sono abbastanza picchetti disponibili nei settori attivi. Ne servono ${numbersCount}, ma ce ne sono ${availableNumbers.length}.`);
      return;
    }

    // Shuffle arrays
    const shuffledParticipants = [...unassigned].sort(() => 0.5 - Math.random());
    const shuffledNumbers = [...availableNumbers].sort(() => 0.5 - Math.random());

    const selectedParticipants = shuffledParticipants.slice(0, peopleCount);
    const selectedNumbers = shuffledNumbers.slice(0, numbersCount);

    try {
      const batch = writeBatch(db);
      const extractionResults: {
        firstName: string;
        lastName: string;
        number: number;
        sector: string;
        position: number;
      }[] = [];

      selectedParticipants.forEach((p, index) => {
        const numIndex = Math.floor(index / (peopleCount / numbersCount));
        const assignedNum = selectedNumbers[numIndex];

        const ref = doc(db, `users/${user.uid}/participants`, p.id);
        batch.update(ref, { assignedNumber: assignedNum });

        const info = getSectorInfo(assignedNum);
        extractionResults.push({
          firstName: p.firstName,
          lastName: p.lastName,
          number: assignedNum,
          sector: info.sector,
          position: info.position
        });
      });
      await batch.commit();

      setLastExtraction(extractionResults);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/participants`);
    }
  };

  const extractPreformedPair = async () => {
    const unassigned = participants.filter(p => p.assignedNumber === null && p.teamName);
    const teamsMap = new Map<string, Participant[]>();
    unassigned.forEach(p => {
      if (!teamsMap.has(p.teamName!)) teamsMap.set(p.teamName!, []);
      teamsMap.get(p.teamName!)!.push(p);
    });

    const validPairs = Array.from(teamsMap.values()).filter(team => team.length === 2);
    if (validPairs.length === 0) {
      alert("Nessuna coppia preformata da 2 persone non assegnata trovata. Aggiungi una coppia prima di estrarre.");
      return;
    }

    // Pick a random pair
    const selectedPair = validPairs[Math.floor(Math.random() * validPairs.length)];

    const assignedNumbers = new Set(participants.map(p => p.assignedNumber).filter(n => n !== null));
    const availableNumbers: number[] = [];
    
    activeSectors.forEach(sector => {
      const sectorIndex = SECTOR_LETTERS.indexOf(sector);
      const startNum = sectorIndex * 5 + 1;
      for (let i = 0; i < 5; i++) {
        const num = startNum + i;
        if (num <= settings.maxPicchetti && !assignedNumbers.has(num)) {
          availableNumbers.push(num);
        }
      }
    });

    if (availableNumbers.length < 1) {
      alert(`Non ci sono abbastanza picchetti disponibili nei settori attivi.`);
      return;
    }

    // Pick 1 random number
    const selectedNum = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];

    try {
      const batch = writeBatch(db);
      const extractionResults: any[] = [];

      selectedPair.forEach((p) => {
        const ref = doc(db, `users/${user.uid}/participants`, p.id);
        batch.update(ref, { assignedNumber: selectedNum });

        const info = getSectorInfo(selectedNum);
        extractionResults.push({
          firstName: p.firstName,
          lastName: p.lastName,
          number: selectedNum,
          sector: info.sector,
          position: info.position,
          teamName: p.teamName
        });
      });
      await batch.commit();
      setLastExtraction(extractionResults);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/participants`);
    }
  };

  const extractTeam = async () => {
    const unassigned = participants.filter(p => p.assignedNumber === null && p.teamName);
    const teamsMap = new Map<string, Participant[]>();
    unassigned.forEach(p => {
      if (!teamsMap.has(p.teamName!)) teamsMap.set(p.teamName!, []);
      teamsMap.get(p.teamName!)!.push(p);
    });

    const validTeams = Array.from(teamsMap.values()).filter(team => team.length === 4);
    if (validTeams.length === 0) {
      alert("Nessuna squadra da 4 persone non assegnata trovata. Aggiungi una squadra prima di estrarre.");
      return;
    }

    // Pick a random team
    const selectedTeam = validTeams[Math.floor(Math.random() * validTeams.length)];

    const assignedNumbers = new Set(participants.map(p => p.assignedNumber).filter(n => n !== null));
    const availableBySector = new Map<string, number[]>();
    
    activeSectors.forEach(sector => {
      const sectorIndex = SECTOR_LETTERS.indexOf(sector);
      const startNum = sectorIndex * 5 + 1;
      const availableInThisSector = [];
      for (let i = 0; i < 5; i++) {
        const num = startNum + i;
        if (num <= settings.maxPicchetti && !assignedNumbers.has(num)) {
          availableInThisSector.push(num);
        }
      }
      if (availableInThisSector.length > 0) {
        availableBySector.set(sector, availableInThisSector);
      }
    });

    if (availableBySector.size < 4) {
      alert(`Non ci sono abbastanza settori con posti disponibili. Ne servono almeno 4, ma ce ne sono solo ${availableBySector.size}.`);
      return;
    }

    // Pick 4 random sectors
    const shuffledSectors = Array.from(availableBySector.keys()).sort(() => 0.5 - Math.random()).slice(0, 4);
    
    // Pick 1 random number from each of the 4 sectors
    const selectedNumbers = shuffledSectors.map(sector => {
      const nums = availableBySector.get(sector)!;
      return nums[Math.floor(Math.random() * nums.length)];
    });

    try {
      const batch = writeBatch(db);
      const extractionResults: any[] = [];

      selectedTeam.forEach((p, index) => {
        const assignedNum = selectedNumbers[index];
        const ref = doc(db, `users/${user.uid}/participants`, p.id);
        batch.update(ref, { assignedNumber: assignedNum });

        const info = getSectorInfo(assignedNum);
        extractionResults.push({
          firstName: p.firstName,
          lastName: p.lastName,
          number: assignedNum,
          sector: info.sector,
          position: info.position,
          teamName: p.teamName
        });
      });
      await batch.commit();
      setLastExtraction(extractionResults);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/participants`);
    }
  };

  const sectorsMap = new Map<string, { position: number, participant: Participant }[]>();
  participants.forEach(p => {
    if (p.assignedNumber !== null) {
      const info = getSectorInfo(p.assignedNumber);
      if (!sectorsMap.has(info.sector)) {
        sectorsMap.set(info.sector, []);
      }
      sectorsMap.get(info.sector)!.push({ position: info.position, participant: p });
    }
  });

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="bg-blue-600 text-white shadow-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" />
            Gestione Estrazioni
          </h1>
          <button 
            onClick={logout}
            className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded-lg transition text-sm font-medium"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Esci</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Participants & Settings */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Settings Section */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-800">
              <Settings className="w-5 h-5 text-blue-600" />
              Impostazioni Picchetti
            </h2>
            <div className="flex items-center justify-between">
              <label htmlFor="maxPicchetti" className="text-sm text-gray-600 font-medium">Numero Massimo (1-100):</label>
              <input 
                id="maxPicchetti"
                type="number" 
                min="1" 
                max="100" 
                value={settings.maxPicchetti}
                onChange={handleUpdateMaxPicchetti}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              />
            </div>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <label className="text-sm text-gray-600 font-medium mb-3 block">Settori Attivi (clicca per attivare/disattivare):</label>
              <div className="flex flex-wrap gap-2">
                {availableSectors.map(sector => {
                  const isActive = activeSectors.includes(sector);
                  return (
                    <button
                      key={sector}
                      onClick={() => toggleSector(sector)}
                      className={`w-10 h-10 rounded-lg font-bold text-sm flex items-center justify-center transition ${isActive ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                      title={isActive ? `Disattiva settore ${sector}` : `Attiva settore ${sector}`}
                    >
                      {sector}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-4">
              I settori (A, B, C...) vengono generati in base al numero massimo. Puoi escludere specifici settori dall'estrazione.
            </p>
          </section>

          {/* Add Participant / Team */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-800">
              <UserPlus className="w-5 h-5 text-blue-600" />
              Aggiungi
            </h2>
            
            <div className="flex gap-2 mb-4">
              <button 
                type="button"
                onClick={() => setAddMode('single')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${addMode === 'single' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                Singolo
              </button>
              <button 
                type="button"
                onClick={() => setAddMode('pair')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${addMode === 'pair' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                Coppia (2)
              </button>
              <button 
                type="button"
                onClick={() => setAddMode('team')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${addMode === 'team' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                Squadra (4)
              </button>
            </div>

            {addMode === 'single' && (
              <form onSubmit={handleAddParticipant} className="space-y-4">
                <div>
                  <input 
                    type="text" 
                    placeholder="Nome" 
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                    required
                  />
                </div>
                <div>
                  <input 
                    type="text" 
                    placeholder="Cognome" 
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                    required
                  />
                </div>
                <button 
                  type="submit"
                  className="w-full bg-blue-600 text-white font-medium py-2 rounded-lg hover:bg-blue-700 transition"
                >
                  Aggiungi Singolo
                </button>
              </form>
            )}
            
            {addMode === 'pair' && (
              <form onSubmit={handleAddPair} className="space-y-4">
                <div>
                  <input 
                    type="text" 
                    placeholder="Nome Coppia" 
                    value={pairName}
                    onChange={e => setPairName(e.target.value)}
                    className="w-full px-4 py-2 border border-emerald-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition font-semibold"
                    required
                  />
                </div>
                <div className="space-y-3">
                  {pairMembers.map((member, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder={`Nome ${idx + 1}`} 
                        value={member.firstName}
                        onChange={e => {
                          const newMembers = [...pairMembers];
                          newMembers[idx].firstName = e.target.value;
                          setPairMembers(newMembers);
                        }}
                        className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition text-sm"
                        required
                      />
                      <input 
                        type="text" 
                        placeholder={`Cognome ${idx + 1}`} 
                        value={member.lastName}
                        onChange={e => {
                          const newMembers = [...pairMembers];
                          newMembers[idx].lastName = e.target.value;
                          setPairMembers(newMembers);
                        }}
                        className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition text-sm"
                        required
                      />
                    </div>
                  ))}
                </div>
                <button 
                  type="submit"
                  className="w-full bg-emerald-600 text-white font-medium py-2 rounded-lg hover:bg-emerald-700 transition"
                >
                  Aggiungi Coppia
                </button>
              </form>
            )}

            {addMode === 'team' && (
              <form onSubmit={handleAddTeam} className="space-y-4">
                <div>
                  <input 
                    type="text" 
                    placeholder="Nome Squadra" 
                    value={teamName}
                    onChange={e => setTeamName(e.target.value)}
                    className="w-full px-4 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none transition font-semibold"
                    required
                  />
                </div>
                <div className="space-y-3">
                  {teamMembers.map((member, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder={`Nome ${idx + 1}`} 
                        value={member.firstName}
                        onChange={e => {
                          const newMembers = [...teamMembers];
                          newMembers[idx].firstName = e.target.value;
                          setTeamMembers(newMembers);
                        }}
                        className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none transition text-sm"
                        required
                      />
                      <input 
                        type="text" 
                        placeholder={`Cognome ${idx + 1}`} 
                        value={member.lastName}
                        onChange={e => {
                          const newMembers = [...teamMembers];
                          newMembers[idx].lastName = e.target.value;
                          setTeamMembers(newMembers);
                        }}
                        className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none transition text-sm"
                        required
                      />
                    </div>
                  ))}
                </div>
                <button 
                  type="submit"
                  className="w-full bg-purple-600 text-white font-medium py-2 rounded-lg hover:bg-purple-700 transition"
                >
                  Aggiungi Squadra
                </button>
              </form>
            )}
          </section>

          {/* Participants List */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col h-[500px]">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-gray-800">
                <Users className="w-5 h-5 text-blue-600" />
                Lista ({participants.length})
              </h2>
              <div className="flex items-center gap-3">
                {participants.some(p => p.assignedNumber !== null) && (
                  <button 
                    onClick={handleClearAllAssignments}
                    className="text-xs text-orange-600 hover:text-orange-800 font-medium flex items-center gap-1"
                    title="Rimuovi tutte le assegnazioni"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Azzera Assegn.
                  </button>
                )}
                {participants.length > 0 && (
                  <button 
                    onClick={handleClearAllParticipants}
                    className="text-xs text-red-600 hover:text-red-800 font-medium flex items-center gap-1"
                    title="Elimina tutti i partecipanti"
                  >
                    <Trash2 className="w-3 h-3" />
                    Svuota Lista
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {participants.length === 0 ? (
                <p className="text-center text-gray-500 text-sm py-8">Nessun partecipante. Aggiungine uno!</p>
              ) : (
                participants.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-800">{p.firstName} {p.lastName}</span>
                      {p.teamName && (
                        <span className="text-xs text-purple-600 font-medium mt-0.5">Squadra: {p.teamName}</span>
                      )}
                      {p.assignedNumber !== null ? (
                        <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full w-fit mt-1">
                          Settore {getSectorInfo(p.assignedNumber).sector}{getSectorInfo(p.assignedNumber).position} (N° {p.assignedNumber})
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 mt-1">Non assegnato</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {p.assignedNumber !== null && (
                        <button 
                          onClick={() => handleClearAssignment(p.id)}
                          className="p-1.5 text-orange-500 hover:bg-orange-100 rounded-md transition"
                          title="Rimuovi assegnazione"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                      <button 
                        onClick={() => handleDeleteParticipant(p.id)}
                        className="p-1.5 text-red-500 hover:bg-red-100 rounded-md transition"
                        title="Elimina partecipante"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

        </div>

        {/* Right Column: Extractions & Sectors */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Extraction Controls */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold mb-6 flex items-center gap-2 text-gray-800">
              <Shuffle className="w-5 h-5 text-blue-600" />
              Estrazione Casuale
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <button 
                onClick={() => extractRandom(1, 1)}
                className="flex flex-col items-center justify-center gap-2 p-4 border-2 border-blue-100 bg-blue-50 rounded-xl hover:bg-blue-100 hover:border-blue-200 transition text-blue-800"
              >
                <UserIcon className="w-8 h-8" />
                <span className="font-semibold">Individuale</span>
                <span className="text-xs opacity-75 text-center">1 persona<br/>1 picchetto</span>
              </button>
              
              <button 
                onClick={() => extractRandom(2, 1)}
                className="flex flex-col items-center justify-center gap-2 p-4 border-2 border-teal-100 bg-teal-50 rounded-xl hover:bg-teal-100 hover:border-teal-200 transition text-teal-800"
              >
                <UsersIcon className="w-8 h-8" />
                <span className="font-semibold">Coppia Casuale</span>
                <span className="text-xs opacity-75 text-center">2 persone singole<br/>1 picchetto</span>
              </button>

              <button 
                onClick={extractPreformedPair}
                className="flex flex-col items-center justify-center gap-2 p-4 border-2 border-emerald-100 bg-emerald-50 rounded-xl hover:bg-emerald-100 hover:border-emerald-200 transition text-emerald-800"
              >
                <UsersIcon className="w-8 h-8" />
                <span className="font-semibold">Coppia Preform.</span>
                <span className="text-xs opacity-75 text-center">1 coppia<br/>1 picchetto</span>
              </button>

              <button 
                onClick={extractTeam}
                className="flex flex-col items-center justify-center gap-2 p-4 border-2 border-purple-100 bg-purple-50 rounded-xl hover:bg-purple-100 hover:border-purple-200 transition text-purple-800"
              >
                <div className="flex -space-x-2">
                  <UserIcon className="w-8 h-8" />
                  <UserIcon className="w-8 h-8" />
                  <UserIcon className="w-8 h-8" />
                </div>
                <span className="font-semibold">A Squadra</span>
                <span className="text-xs opacity-75 text-center">1 squadra<br/>4 settori div.</span>
              </button>
            </div>
          </section>

          {/* Sectors Grid */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold mb-6 flex items-center gap-2 text-gray-800">
              <div className="w-5 h-5 rounded bg-blue-600 text-white flex items-center justify-center text-xs font-bold">A</div>
              Settori e Picchetti
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {availableSectors.map((sectorLetter, sIdx) => {
                const sectorStartNum = sIdx * 5 + 1;
                // Only show positions up to maxPicchetti
                const positions = [];
                for (let i = 1; i <= 5; i++) {
                  const picchettoNum = sectorStartNum + i - 1;
                  if (picchettoNum <= settings.maxPicchetti) {
                    positions.push({ pos: i, num: picchettoNum });
                  }
                }

                if (positions.length === 0) return null;

                const assignedInSector = sectorsMap.get(sectorLetter) || [];
                const isActive = activeSectors.includes(sectorLetter);

                return (
                  <div key={sectorLetter} className={`border rounded-xl overflow-hidden flex flex-col transition-opacity duration-200 ${isActive ? 'border-gray-200' : 'border-gray-200 opacity-60 bg-gray-50'}`}>
                    <div className={`px-4 py-2 border-b flex justify-between items-center ${isActive ? 'bg-gray-100 border-gray-200' : 'bg-gray-200 border-gray-300'}`}>
                      <h3 className="font-bold text-gray-800">
                        Settore {sectorLetter}
                        {!isActive && <span className="text-xs text-red-500 ml-2 font-normal uppercase tracking-wider">Disattivato</span>}
                      </h3>
                      <span className="text-xs text-gray-500 font-medium">Picchetti {sectorStartNum}-{sectorStartNum + positions.length - 1}</span>
                    </div>
                    <div className="divide-y divide-gray-100 flex-1">
                      {positions.map(({ pos, num }) => {
                        const assigned = assignedInSector.filter(a => a.position === pos);
                        return (
                          <div key={pos} className="flex items-center p-3 hover:bg-gray-50 transition">
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-800 font-bold flex items-center justify-center text-sm mr-3 shrink-0">
                              {pos}
                            </div>
                            <div className="flex-1 min-w-0">
                              {assigned.length > 0 ? (
                                <div className="flex flex-col">
                                  {assigned.map((a, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                      <span className="font-semibold text-gray-900 truncate">
                                        {a.participant.firstName} {a.participant.lastName}
                                      </span>
                                      {a.participant.teamName && (
                                        <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium truncate max-w-[100px]">
                                          {a.participant.teamName}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                  <span className="text-xs text-gray-500">N° {num}</span>
                                </div>
                              ) : (
                                <span className="text-gray-400 italic text-sm">Vuoto (N° {num})</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

        </div>
      </main>

      {/* Extraction Result Modal */}
      {lastExtraction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">Estrazione Completata!</h3>
            <div className="space-y-3 mb-6 max-h-[60vh] overflow-y-auto">
              {lastExtraction.map((res, i) => (
                <div key={i} className="flex items-center justify-between bg-blue-50 p-4 rounded-xl border border-blue-100">
                  <div>
                    <span className="font-semibold text-gray-800 text-lg block">{res.firstName} {res.lastName}</span>
                    {res.teamName && <span className="text-xs font-medium text-purple-600">Squadra: {res.teamName}</span>}
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-blue-600">N° {res.number}</div>
                    <div className="text-sm font-medium text-blue-800">Settore {res.sector}{res.position}</div>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setLastExtraction(null)}
              className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition shadow-sm"
            >
              Chiudi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <Users className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Gestione Estrazioni</h1>
          <p className="text-gray-600 mb-8">Accedi per gestire i partecipanti, i settori e le estrazioni casuali.</p>
          <button 
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 text-gray-800 font-semibold py-3 px-4 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Accedi con Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <MainApp user={user} />
    </ErrorBoundary>
  );
}
