@echo off
echo Opening firewall ports for Reestr...
netsh advfirewall firewall add rule name="Reestr Backend 8080" dir=in action=allow protocol=TCP localport=8080
netsh advfirewall firewall add rule name="Reestr Frontend 5173" dir=in action=allow protocol=TCP localport=5173
echo Done.
pause
