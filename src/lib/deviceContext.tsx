"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { fetchDevices, type DeviceId } from "./deviceApi";

interface DeviceCtx {
  device: string;
  setDevice: (d: string) => void;
  devices: DeviceId[];
}

const STORAGE_KEY = "waves.device";

export const DeviceContext = createContext<DeviceCtx>({
  device: "auto",
  setDevice: () => {},
  devices: ["cpu"],
});

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [device, setDevice] = useState("auto");
  const [devices, setDevices] = useState<DeviceId[]>(["cpu"]);

  useEffect(() => {
    fetchDevices()
      .then((list) => {
        setDevices(list);
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored && (stored === "cpu" || list.includes(stored as DeviceId))) {
            setDevice(stored);
          }
        } catch {
          /* abaikan access localStorage */
        }
      })
      .catch(() => setDevices(["cpu"]));
  }, []);

  const setAndStore = (d: string) => {
    setDevice(d);
    try {
      localStorage.setItem(STORAGE_KEY, d);
    } catch {
      /* abaikan */
    }
  };

  return (
    <DeviceContext.Provider value={{ device, setDevice: setAndStore, devices }}>
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevice(): DeviceCtx {
  return useContext(DeviceContext);
}